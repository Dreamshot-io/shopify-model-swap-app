## Local PostgreSQL for Development

This project includes a Dockerized PostgreSQL instance for local development.

### Start Database

```bash
bun run db:up
```

Wait until the container is healthy:

```bash
bun run db:logs
```

### Connection String

Set `DATABASE_URL` in `.env` to:

```
postgresql://postgres:postgres@localhost:5432/dreamshot?schema=public
```

### Initialize Schema

```bash
bun run setup
```

This runs `prisma generate` and `prisma db push` to sync your schema.

### Access psql

```bash
bun run db:psql
```

### Stop Database

```bash
bun run db:down
```

### Notes

- Data persists in a Docker volume `pgdata`.
- Use separate databases for branches by changing `POSTGRES_DB` and `DATABASE_URL`.
