# syntax=docker/dockerfile:1
FROM node:18-alpine
RUN apk add git
RUN git clone https://github.com/nestrischamps/nestrischamps.git
WORKDIR ./nestrischamps
COPY *.pem ./
ARG HTTPS
ENV TLS_KEY=${HTTPS:+key.pem}
ENV TLS_CERT=${HTTPS:+cert.pem}
RUN npm ci
CMD [ "npm", "run", "start" ]
