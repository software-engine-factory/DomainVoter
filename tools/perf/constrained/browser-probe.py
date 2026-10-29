"""Local real Next server-action votes. Uses only a disposable probe account and restores it."""
import json, pathlib, subprocess, sys, time, urllib.parse
from playwright.sync_api import sync_playwright, expect

container, base, job, output = sys.argv[1:]
assert urllib.parse.urlparse(base).hostname in ('127.0.0.1', 'localhost')
def read(name):
    return subprocess.check_output(['docker','exec',container,'cat','/app/data/'+name], text=True).strip()
setup=json.loads(read('.perf-setup.json'))
cookie=read('.perf-probe-cookie').split('=',1)[1]
admin=read('.perf-cookie')
samples=[]; errors=[]; js_errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1280,'height':900})
    context.add_cookies([{'name':'dv_session','value':cookie,'url':base,'httpOnly':True,'sameSite':'Lax'}])
    context.route('**/*',lambda route: route.continue_() if urllib.parse.urlparse(route.request.url).hostname in ('127.0.0.1','localhost') else route.abort())
    page=context.new_page()
    page.on('pageerror',lambda error:js_errors.append(str(error)))
    try:
        page.goto(base+'/vote/'+str(setup['roundId']),wait_until='networkidle',timeout=60000)
        button=page.locator('button.vote-tile').nth(1)
        expect(button).to_be_enabled(timeout=30000)
        assert button.get_attribute('aria-pressed')=='false'
        deadline=time.monotonic()+30*60
        while time.monotonic()<deadline:
            response=context.request.get(base+'/api/creation-jobs/'+job,headers={'Cookie':admin},timeout=30000)
            state=response.json().get('state')
            if state in ('completed','failed','cancelled'): break
            for want in ('true','false'):
                start=time.perf_counter()
                with page.expect_response(lambda r:r.request.method=='POST' and 'next-action' in r.request.headers,timeout=30000) as pending:
                    button.click(timeout=30000)
                assert pending.value.status==200
                expect(button).to_be_enabled(timeout=30000)
                expect(button).to_have_attribute('aria-pressed',want,timeout=30000)
                samples.append((time.perf_counter()-start)*1000)
            check=context.request.get(base+'/api/rounds/'+str(setup['roundId'])+'/votes')
            assert check.json()['count']==0
            page.wait_for_timeout(500)
        else: raise RuntimeError('local browser probe deadline exceeded')
    except Exception as error:
        errors.append(type(error).__name__+': '+str(error))
    finally:
        # Only this generated fixture account/round can be cleaned by this helper.
        subprocess.run(['docker','exec',container,'node','/perf/cleanup-probe.cjs'],check=True,stdout=subprocess.DEVNULL)
        browser.close()
values=sorted(samples)
result={'actions':len(samples),'p50Ms':values[len(values)//2] if values else None,'p95Ms':values[min(len(values)-1,int(len(values)*.95))] if values else None,'maxMs':max(values) if values else None,'errors':errors,'javascriptErrors':js_errors,'probeVotesRestored':True,'note':'Real browser clicks await Next server-action response and enabled button. Disposable fixture user only.'}
pathlib.Path(output).parent.mkdir(parents=True,exist_ok=True)
pathlib.Path(output).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
if errors or js_errors or not samples: sys.exit(1)
