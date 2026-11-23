FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data
ENV PORT=3080
ENV HOST=0.0.0.0
EXPOSE 3080
VOLUME ["/app/data"]
CMD ["node", "server.js"]
