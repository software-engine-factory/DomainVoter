"""Check the local full-data preview without printing cookies or domain names."""
import json, pathlib, subprocess, sys, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright, expect

container, base, output = sys.argv[1:]
assert urllib.parse.urlparse(base).hostname in ('127.0.0.1', 'localhost')

def cookie(name):
    return subprocess.check_output(['docker', 'exec', container, 'cat', '/app/data/' + name], text=True).strip().split('=', 1)[1]

def sql_json(sql):
    script = 'const D=require("better-sqlite3"),d=new D("/app/data/voting.db",{readonly:true}); console.log(JSON.stringify(d.prepare(' + json.dumps(sql) + ').all()))'
    return json.loads(subprocess.check_output(['docker', 'exec', container, 'node', '-e', script], text=True))

round_id = sql_json('SELECT rr.round_id FROM round_domain_ranges rr JOIN rounds r ON r.id=rr.round_id WHERE r.creation_job_id IS NULL ORDER BY rr.round_id LIMIT 1')[0]['round_id']
setup = json.loads(subprocess.check_output(['docker', 'exec', container, 'cat', '/app/data/.perf-setup.json'], text=True))
hidden = sql_json(f'SELECT r.id FROM rounds r WHERE EXISTS(SELECT 1 FROM round_assignees a WHERE a.round_id=r.id) AND NOT EXISTS(SELECT 1 FROM round_assignees a WHERE a.round_id=r.id AND a.user_id={int(setup["probeUserId"])}) LIMIT 1')
urllib.request.urlopen(base + '/api/dataset-version', timeout=180).read()
result = {'roundId': round_id, 'routes': [], 'javascriptErrors': [], 'timingNote': 'Browser navigation start to painted row, one initial browser navigation and five repeat visits. Server cache state depends on prior activity; Python wall time is retained separately.'}
with sync_playwright() as p:
    browser = p.chromium.launch()
    def context(name=None):
        c = browser.new_context(viewport={'width': 1280, 'height': 900})
        c.route('**/*', lambda route: route.continue_() if urllib.parse.urlparse(route.request.url).hostname in ('127.0.0.1', 'localhost') else route.abort())
        if name:
            c.add_cookies([{'name': 'dv_session', 'value': cookie(name), 'url': base, 'httpOnly': True, 'sameSite': 'Lax'}])
        return c
    admin = context('.perf-cookie')
    page = admin.new_page()
    page.add_init_script('''
      window.__dvVisibleAt = null;
      const deadline = performance.now() + 60000;
      function checkRows() {
        const row = document.querySelector('span.break-all.font-mono.font-semibold');
        if (row && row.getClientRects().length && getComputedStyle(row).visibility !== 'hidden') {
          requestAnimationFrame(() => { window.__dvVisibleAt = performance.now(); });
        } else if (performance.now() < deadline) requestAnimationFrame(checkRows);
      }
      requestAnimationFrame(checkRows);
    ''')
    page.on('pageerror', lambda e: result['javascriptErrors'].append(str(e)))
    row_selector = 'span.break-all.font-mono.font-semibold'
    for route in ['/admin/explore?lmin=5&lmax=5&q=ab', '/admin/explore?pat=_a_b_&exact=1', '/admin/explore?lmin=5&lmax=5&sort=price_asc']:
        samples = []
        for attempt in range(6):
            started = time.perf_counter()
            response = page.goto(base + route, wait_until='commit', timeout=60000)
            page.wait_for_function('Number.isFinite(window.__dvVisibleAt)', timeout=60000)
            wall_ms = (time.perf_counter() - started) * 1000
            browser_ms = page.evaluate('window.__dvVisibleAt')
            page.wait_for_load_state('networkidle', timeout=60000)
            if page.locator('.tour-root').count():
                page.get_by_role('dialog').get_by_role('button').last.click()
            assert response.status == 200
            assert page.locator(row_selector).count() == 50
            samples.append({'browserVisibleMs': browser_ms, 'pythonWallMs': wall_ms})
        warm = sorted(s['browserVisibleMs'] for s in samples[1:])
        result['routes'].append({'route': route, 'visibleMs': samples[0]['browserVisibleMs'], 'warmP50Ms': warm[2], 'warmP95Ms': warm[-1], 'samples': samples, 'rows': 50})
        print(json.dumps(result['routes'][-1]), flush=True)
    # Real next/previous links exercise the keyset boundary through the client router.
    first_names = page.locator(row_selector).all_text_contents()
    page.locator('a[href*="cursor="][href*="direction=next"]').click()
    page.wait_for_url('**/*direction=next*', timeout=60000)
    expect(page.locator(row_selector).first).not_to_have_text(first_names[0], timeout=60000)
    second_names = page.locator(row_selector).all_text_contents()
    assert not set(first_names).intersection(second_names)
    page.locator('a[href*="cursor="][href*="direction=prev"]').click()
    page.wait_for_url('**/*direction=prev*', timeout=60000)
    expect(page.locator(row_selector).first).to_have_text(first_names[0], timeout=60000)
    assert page.locator(row_selector).all_text_contents() == first_names
    result['cursorRoundTrip'] = True
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(base + '/admin/explore?lmin=5&lmax=5&q=ab', wait_until='networkidle', timeout=60000)
    result['mobileOverflowPx'] = page.evaluate('Math.max(0,document.documentElement.scrollWidth-innerWidth)')
    assert result['mobileOverflowPx'] <= 1

    voter = context('.perf-probe-cookie')
    vote_page = voter.new_page()
    vote_page.on('pageerror', lambda e: result['javascriptErrors'].append(str(e)))
    cards = voter.request.get(base + f'/api/rounds/{round_id}/cards').json()
    assert cards['cards'] and all(c['id'] < 0 for c in cards['cards'])
    vote_page.goto(base + f'/vote/{round_id}', wait_until='networkidle', timeout=60000)
    result['voterRenderedCards'] = vote_page.locator('button.vote-tile').count()
    assert result['voterRenderedCards'] == 50
    result['voterFilters'] = []
    for query, predicate in [('q=ab', "i.name LIKE '%ab%'"), ('pat=_a_b_&exact=1', "i.name LIKE '_a_b_%'"), ('page=4000&size=50', '1=1')]:
        expected = sql_json(f'SELECT COUNT(*) AS n FROM selection_items i JOIN round_domain_ranges rr ON rr.selection_id=i.selection_id AND i.position BETWEEN rr.start_position AND rr.end_position WHERE rr.round_id={round_id} AND {predicate}')[0]['n']
        samples = []
        for _ in range(5):
            started = time.perf_counter()
            response = voter.request.get(base + f'/api/rounds/{round_id}/cards?' + query)
            samples.append((time.perf_counter() - started) * 1000)
            payload = response.json()
            assert response.status == 200 and payload['matched'] == expected
            assert len(payload['cards']) <= 50 and len(response.body()) < 50000
        samples.sort()
        result['voterFilters'].append({'query': query, 'matched': expected, 'p50Ms': samples[2], 'p95Ms': samples[-1], 'samplesMs': samples})
    button = vote_page.locator('button.vote-tile').first
    expect(button).to_have_attribute('aria-pressed', 'false')
    for want in ('true', 'false'):
        with vote_page.expect_response(lambda r: r.request.method == 'POST' and 'next-action' in r.request.headers, timeout=30000) as action:
            button.click()
        assert action.value.status == 200
        expect(button).to_be_enabled(timeout=30000)
        expect(button).to_have_attribute('aria-pressed', want, timeout=30000)
    assert voter.request.get(base + f'/api/rounds/{round_id}/votes').json()['count'] == 0
    result['compactVoteRestored'] = True
    if hidden:
        assert voter.request.get(base + '/vote/' + str(hidden[0]['id'])).status == 404
        result['unassignedRound404'] = True
    anonymous = context()
    response = anonymous.request.get(base + f'/api/rounds/{round_id}/cards', max_redirects=0)
    assert response.status in (302, 303, 307, 401)
    result['anonymousDenied'] = True
    browser.close()
result['passed'] = not result['javascriptErrors']
pathlib.Path(output).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result))
assert result['passed']
