FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/ingestor/package.json apps/ingestor/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --omit=dev

COPY tsconfig.base.json ./
COPY apps/ingestor apps/ingestor
COPY packages/db packages/db
COPY packages/domain packages/domain

ENV NODE_ENV=production
CMD ["npm", "run", "start", "--workspace", "@norway-ship-tracker/ingestor"]
