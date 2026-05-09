FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# data/ is created at runtime; we mount it as a volume in compose.

CMD ["bun", "run", "src/discord.ts"]
