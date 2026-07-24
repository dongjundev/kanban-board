# ---- 빌드 스테이지: Vite 프로덕션 번들 생성 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build          # tsc 타입체크 + vite build → /app/dist

# ---- 서빙 스테이지: nginx가 정적 파일 서빙 + /api 프록시 ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
