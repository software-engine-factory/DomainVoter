# رأی دامنه

A private voting board for domain shortlists. An admin opens a round from a spreadsheet. Voters page through the list and cast one vote per domain. Only the admin sees who voted, what they chose, and how much of the list has been seen.

The interface is Persian and right-to-left. Domain names stay in Latin.

## How a round works

1. Voters register with a username and password. There is no email and no password reset.
2. The admin uploads a CSV, maps the domain, price, and premium columns, and opens the round. Empty names are skipped. If a domain is repeated, the first row is kept.
3. A voter picks a range, then moves through it 20 domains at a time. Clicking a domain gives it one vote. Clicking again takes the vote back.
4. Opening a page of 20 marks those domains as seen for that voter. Coverage is the share of domains that at least one voter has opened.
5. The admin can read the results, each voter’s ballot, and the domains nobody has opened, then export a CSV or close the round.
6. A later round can be copied from an earlier one, keeping only the domains that match a vote count, a price band, or a premium filter. The copy starts with zero votes and zero views.

Voters never see other people’s votes, the tally, or the coverage bar.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Account | Username | Password |
| --- | --- | --- |
| Admin | `admin` | `admin` |
| Voter | register one from the sign-up page | chosen at registration |

Usernames are 3–32 characters: lowercase letters, numbers, and underscores. The name `admin` cannot be registered.

`fixtures/sample-domains.csv` is a small file for trying the upload. Map `domain`, `price`, and `premium`. Premium cells accept `1`, `true`, `yes`, `y`, `premium`, `بله`, and `پریمیوم`. Prices may include a currency sign and commas.

The database and the session secret are created on first use in `data/`. That folder stays on your machine and is not committed.

## Deploy on Coolify

Connect this repository as an Application and set the build pack to **Dockerfile**. The container listens on port **3000**. Point the health check at `/health`.

Add persistent storage mounted at **`/app/data`**. SQLite and the session secret live there. Without that volume, the next deploy starts from an empty database and signs everyone out.

`docker-compose.yml` is the same setup for a local container:

```bash
docker compose up --build
```

The first admin account on a fresh volume is `admin` / `admin`.

## Stack

Next.js, React, SQLite through Drizzle and `better-sqlite3`, and Tailwind. One Node process serves the app and the database. There is no separate API.
