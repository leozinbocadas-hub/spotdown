# Usar a imagem oficial do Nginx para servir conteúdo estático
FROM nginx:alpine

# Remover a página padrão do Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copiar os arquivos do diretório 'site' para o diretório de serviço do Nginx
COPY ./site/ /usr/share/nginx/html/

# Expor a porta 80
EXPOSE 80

# Comando para iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
