# Chess Distance Calculator

Find the shortest opponent path between any two chess players. Like [CSauthors.net/distance](https://csauthors.net/distance) but for chess.

- **Distance 0** = same player
- **Distance 1** = direct opponents (they've played each other)
- **Distance 2** = one player apart (A played C, C played B)
- etc.

## Setup

### 1. Database
Create a free PostgreSQL database at [neon.tech](https://neon.tech) and set the connection string:

```bash
cp .env.local.example .env.local
# Edit .env.local with your DATABASE_URL
```

### 2. Install & Run
```bash
npm install
npm run dev
```

### 3. Load Data (ETL)
```bash
npm run etl
```

This downloads TWIC PGN archives, parses game headers, and builds the player opponent graph in PostgreSQL.

## Tech Stack
- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com) v4
- [Neon](https://neon.tech) serverless PostgreSQL
- [Vercel](https://vercel.com) deployment

## License
MIT
