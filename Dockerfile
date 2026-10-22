# Página de medição de DP — estática, servida por nginx (só o que a página usa; docs/testes ficam fora)
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
COPY vendor /usr/share/nginx/html/vendor
COPY audio /usr/share/nginx/html/audio
