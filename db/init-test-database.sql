-- Roda uma vez, na criação do volume do PostgreSQL do docker compose.
-- Banco separado para `npm run test:pg`: os testes esvaziam as tabelas a cada caso.
CREATE DATABASE bcb_test;
