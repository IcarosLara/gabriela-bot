# Usamos una imagen oficial de Node.js robusta y estable
FROM node:20-bullseye

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiamos primero las dependencias para aprovechar el caché de Docker
COPY package*.json ./

# Instalación limpia y forzada de todas las dependencias (incluyendo Baileys, Express y GenAI)
RUN npm install --production=false

# Copiamos el resto del código fuente del monorepo (bot.js, index.html, etc.)
COPY . .

# Exponemos el puerto que Railway o cualquier otro host asignará
EXPOSE 3000

# Comando de arranque directo por la fuerza
CMD ["node", "bot.js"]
