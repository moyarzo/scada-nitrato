# SCADA-LB — Silos Nitrato de Amonio

Dashboard de monitoreo en tiempo real para los **8 silos de Nitrato de Amonio** de la planta Los Bronces.

> Dashboard independiente del sistema de Silos Matriz. Corre en su propia VM en el puerto 3000.

![Dashboard](https://img.shields.io/badge/stack-Node.js%20%7C%20Socket.IO%20%7C%20MQTT%20%7C%20Chart.js-blue)

---

## Características

- Visualización en tiempo real de nivel, volumen y masa (ton) por silo
- Gráfico de tendencia diaria del totalizador de Nitrato (07:00–19:00)
- Mini-gráfico de % de llenado por silo
- Registro de turno (07h inicio / 19h cierre)
- Historial de 30 días navegable por fecha
- Selector de modo REAL / DEMO
- Exportación Excel diario (`stock_nitrato_YYYYMMDD.xlsx`)
- Exportación CSV historial 30 días (`resumen_nitrato_YYYYMMDD.csv`)
- Alertas visuales de nivel alto (≥85% warning, ≥90% crítico)

---

## Geometría de los silos

| Sección       | Dimensión                                      |
|---------------|------------------------------------------------|
| Cilindro      | 3.48 × 3.48 m base, altura 5.95 m             |
| Tolva inferior| Base sup. 3.48 m / Base inf. 2.78 m / Alt. 0.78 m |
| Altura total  | 6.73 m                                         |
| Volumen total | 79.73 m³                                       |
| Densidad      | 750 kg/m³                                      |

---

## Requisitos

- [Node.js](https://nodejs.org/) ≥ 18
- [npm](https://npmjs.com/)
- [Eclipse Mosquitto](https://mosquitto.org/) (broker MQTT local)
- [PM2](https://pm2.keymetrics.io/) (para producción)

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/TU_USUARIO/scada-silos-nitrato.git
cd scada-silos-nitrato

# 2. Instalar dependencias
npm install

# 3. Copiar archivos que NO están en el repo
#    (ver sección "Archivos manuales" más abajo)
```

---

## Archivos manuales (no incluidos en el repo)

Estos archivos deben copiarse manualmente a la raíz del proyecto antes de correr:

| Archivo         | Descripción                                              |
|-----------------|----------------------------------------------------------|
| `styles.css`    | Estilos del dashboard (copiar desde repo scada-silos)    |
| `logo.png`      | Logo de la empresa                                       |
| `template.xlsx` | Plantilla Excel para exportación diaria                  |

```bash
# Ejemplo: copiar desde el repo de Matriz si está en la misma máquina
cp ../scada-silos/styles.css .
cp ../scada-silos/logo.png .
cp ../scada-silos/template.xlsx .
```

---

## MQTT — Topics esperados

El servidor se suscribe a:

```
planta/losbronces/nitrato/#
```

Cada silo publica en su topic correspondiente:

```
planta/losbronces/nitrato/tanque1
planta/losbronces/nitrato/tanque2
...
planta/losbronces/nitrato/tanque8
```

**Formato del payload** (igual que silos Matriz — Delta HMI con word-swap):

```json
{ "d": { "tipo": 12345678 } }
```

El valor es un `uint32` big-endian con word-swap que representa la distancia en metros desde el sensor (montado en la parte superior del silo).

---

## Ejecución

### Desarrollo
```bash
node server.js
```

### Producción con PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # para autoarranque en boot
```

Acceder en: `http://localhost:3000`

---

## Archivos de datos (generados automáticamente)

Estos archivos se crean en runtime y están excluidos del repo por `.gitignore`:

| Archivo                | Contenido                                      |
|------------------------|------------------------------------------------|
| `turnData.json`        | Registro de turno 07h/19h por día              |
| `historyData.json`     | Historial de totalizador cada 5 min (30 días)  |
| `siloHistoryData.json` | Historial de % llenado por silo cada 5 min     |
| `dailySummary.json`    | Resumen diario guardado a las 19:00            |
| `exports/`             | Archivos Excel/CSV generados por el usuario    |

---

## Estructura del proyecto

```
scada-silos-nitrato/
├── server.js            ← Backend Node.js (Express + Socket.IO + MQTT)
├── app.js               ← Lógica frontend (charts, render, socket client)
├── index.html           ← Interfaz principal
├── styles.css           ← Estilos (copiar desde scada-silos) ⚠
├── logo.png             ← Logo empresa ⚠
├── template.xlsx        ← Plantilla Excel ⚠
├── ecosystem.config.js  ← Configuración PM2
├── package.json
├── .gitignore
└── README.md

⚠ = No incluido en el repo, copiar manualmente
```

---

## Diferencias respecto al dashboard de Matriz

| Aspecto            | Matriz                        | Nitrato                          |
|--------------------|-------------------------------|----------------------------------|
| Productos          | DL-5, VE-03, ASE              | Nitrato de Amonio (único)        |
| Densidad           | 800–1370 kg/m³ (por producto) | 750 kg/m³                        |
| Geometría tolva    | Cono circular                 | Pirámide truncada cuadrada       |
| Altura total silo  | 5.92 m                        | 6.73 m                           |
| Volumen total      | 46.17 m³                      | 79.73 m³                         |
| Color producto     | Azul / Verde / Naranja        | Amarillo (`#ca8a04`)             |
| Selector producto  | Habilitado (modo demo)        | Deshabilitado (siempre Nitrato)  |
| Topic MQTT         | `silos/tanqueN`               | `nitrato/tanqueN`                |
| Puerto             | 3000                          | 3000 (VM separada)               |

---

## Licencia

MIT © 2026 MOH — marco.oyarzo@enaex.com
