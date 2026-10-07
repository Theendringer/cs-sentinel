# 🛡️ CS Sentinel - Plataforma Fullstack de Customer Success Preventivo com IA

Plataforma completa de **Observabilidade e Retenção de Clientes** construída com **Next.js (App Router, TypeScript e Tailwind CSS)**, integrando um **Agente Autônomo de Inteligência Artificial (Google Gemini)**, **Firebase (Firestore & Auth)** e **MongoDB**.

---

## 🏗️ Arquitetura do Sistema

```
                      ┌─────────────────────────────────────┐
                      │    Painel Web Next.js (App Router)   │
                      │   - Autenticação (Firebase Auth)    │
                      │   - Gestão de Limiares / Thresholds │
                      │   - Central de Alertas Prescritivos │
                      └──────────────────┬──────────────────┘
                                         │ (Route Handlers)
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │    Firebase Firestore     │                   │       MongoDB Atlas       │
   │  - monitored_tenants      │                   │  - entidades (empresas)   │
   │  - cs_alerts_history      │                   │  - usuarios (engajamento) │
   └─────────────┬─────────────┘                   │  - logs_erros (falhas)    │
                 │                                 └─────────────┬─────────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         │ (Tools Nativas)
                                         ▼
                      ┌─────────────────────────────────────┐
                      │    Agente Autônomo Gemini (AI CS)   │
                      │   - Function Calling com 3 Tools    │
                      │   - Retry Automático com Backoff    │
                      │   - Diagnóstico Técnico vs Churn    │
                      └─────────────────────────────────────┘
```

---

## 🛠️ Recursos Implementados

### 1. Painel Web & Frontend (`/dashboard` e `/login`)
- **Autenticação com Firebase Auth (`/login`):** Tela de login com Client SDK e acesso rápido de demonstração para desenvolvedores.
- **Aba "Gestão de Monitoramento":**
  - Tabela com todas as entidades do MongoDB conectadas via join lógico com o Firestore.
  - Alternador de ativação de monitoramento por empresa.
  - Ajuste de **Dias sem Acesso** (limiar de churn, padrão: 7 dias).
  - Ajuste de **Máx. Erros em 2h** (limiar técnico, padrão: 5 erros).
  - Botão **Salvar Configurações** (grava no Firestore via `POST /api/monitored-tenants`).
  - Botão de ação rápida **Executar Auditoria Agora** com modal de feedback ao vivo.
- **Aba "Central de Alertas":**
  - Feed de alertas com badges de criticidade (`RISCO TECNICO CRITICO` e `RISCO DE CHURN / DESENGAJAMENTO`).
  - Diagnóstico fundamentado pela IA e **Plano de Ação Prescritivo** para os CSMs intervirem antes do cliente reclamar.

### 2. Rotas de API (Route Handlers)
- `GET /api/entidades`: Lista todas as empresas do MongoDB combinadas com seus thresholds do Firestore.
- `POST /api/monitored-tenants`: Salva ou atualiza a lista de empresas monitoradas no Firestore.
- `GET /api/alerts`: Consulta o histórico ordenado da collection `cs_alerts_history`.
- `POST /api/run-agent`: Dispara a auditoria autônoma sob demanda e devolve o relatório executivo da IA.

### 3. Agente Autônomo de CS (`lib/agent.ts`)
- Utiliza `@google/generative-ai` com suporte a `gemini-3.5-flash-lite` ou `gemini-3.8-flash`.
- Resiliente contra erros transitórios `503` e `429` com retry e backoff exponencial.
- Consome 3 ferramentas nativas (`getMonitoredTenants`, `checkTenantHealth`, `sendCSAlert`).
- Exporta a função `runCustomerSuccessAudit()` para execução via API e CLI.

---

## 🚀 Como Executar

### 1. Pré-requisitos
- Node.js 18+ (recomendado v20+)
- Arquivo `firebase-service-account.json` na raiz
- Arquivo `.env` configurado

### 2. Configurar Variáveis de Ambiente (`.env`)
```env
GEMINI_API_KEY="sua_chave_do_google_ai_studio"
GEMINI_MODEL="gemini-3.5-flash-lite"
MONGODB_URI="mongodb+srv://...mongodb.net/?appName=Cluster0"
MONGODB_DB_NAME="hackathon_db"
CS_WEBHOOK_URL="" # Opcional: webhook do Discord/Slack
```

### 3. Popular Dados de Teste
Para criar as entidades de teste no MongoDB e no Firestore:
```bash
npm run seed
```

### 4. Iniciar a Aplicação Web
```bash
npm run dev
```
Acesse o painel em: **[http://localhost:3000](http://localhost:3000)**

### 5. Executar o Agente via Terminal (Modo CLI)
```bash
npm run agent
```
