## Local PostgreSQL for Development

This project includes a Dockerized PostgreSQL instance for local development.

### Start Database

```bash
npm run db:up
```

Wait until the container is healthy:

```bash
npm run db:logs
```

### Connection String

Set `DATABASE_URL` in `.env` to:

```
postgresql://postgres:postgres@localhost:5432/dreamshot?schema=public
```

### Initialize Schema

```bash
npm run setup
```

This runs `prisma generate` and `prisma db push` to sync your schema.

### Access psql

```bash
npm run db:psql
```

### Stop Database

```bash
npm run db:down
```

### Notes

- Data persists in a Docker volume `pgdata`.
- Use separate databases for branches by changing `POSTGRES_DB` and `DATABASE_URL`.
