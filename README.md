# Hermes Contable Agent Bot (Railway 24/7)

Bot autónomo de contabilidad, facturación DTE, cuentas por cobrar e inventarios impulsado por **Hermes Agent (Nous Research)** y **Google Gemini**, conectado a la base de datos de **eContabilidad** vía **MCP (Model Context Protocol)**.

## Variables de Entorno en Railway (Variables)

Configura las siguientes variables en la pestaña **Variables** de tu servicio en Railway:

| Variable | Valor / Descripción |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de tu bot de Telegram obtenido de `@BotFather` |
| `TELEGRAM_ALLOWED_USERS` | Tu ID numérico de Telegram (para autorizarte solo a ti) |
| `GEMINI_API_KEY` | Clave API de Google AI Studio (`AIzaSy...`) |
| `DATABASE_URL` | URL de conexión PostgreSQL de Supabase |
| `MODEL_PROVIDER` | *(Opcional)* `google` (por defecto) |
| `MODEL_DEFAULT` | *(Opcional)* `gemini-3.6-flash` (por defecto) |
| `OPENROUTER_API_KEY` | *(Opcional)* Clave de OpenRouter si deseas usar otros modelos |
