#!/usr/bin/env bash
# Demonstração do desafio contra a API no ar. Usa só bash e curl.
#
#   docker compose up --build -d && ./scripts/demo.sh
#
# Para a ordem de entrega ficar visível, a entrega simulada precisa ser lenta
# (PROCESSING_DELAY_MS >= 300; o docker compose usa 800): assim as sete mensagens
# se acumulam na fila enquanto o worker ainda está ocupado com a primeira.
set -euo pipefail

API="${API_URL:-http://localhost:3000}"

title() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" <<<"$2" | head -n1; }

# Gera um CPF válido a cada execução, para o script poder rodar várias vezes.
cpf() {
  local d=() sum i
  for i in {0..8}; do d[i]=$((RANDOM % 10)); done
  sum=0; for i in {0..8}; do sum=$((sum + d[i] * (10 - i))); done
  d[9]=$(( (sum % 11) < 2 ? 0 : 11 - (sum % 11) ))
  sum=0; for i in {0..9}; do sum=$((sum + d[i] * (11 - i))); done
  d[10]=$(( (sum % 11) < 2 ? 0 : 11 - (sum % 11) ))
  printf '%s' "${d[@]}"
}

curl -fsS "$API/health" >/dev/null || { echo "API fora do ar em $API. Suba com: docker compose up --build -d"; exit 1; }

DOCUMENT="$(cpf)"
send() { # send <conteúdo> <prioridade>  → corpo da resposta, com o status HTTP na última linha
  curl -sS -w '\n%{http_code}' -X POST "$API/messages" -H 'Content-Type: application/json' -H "X-Client-Document: $DOCUMENT" \
    -d "{\"recipientId\":\"dest-1\",\"recipientName\":\"Destinatário\",\"content\":\"$1\",\"priority\":\"$2\"}"
}

title "1. Cliente pré-pago com R\$ 3,25 (CPF $DOCUMENT)"
CLIENT="$(curl -fsS -X POST "$API/clients" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Demonstração\",\"documentId\":\"$DOCUMENT\",\"documentType\":\"CPF\",\"planType\":\"prepaid\",\"balance\":3.25}")"
CLIENT_ID="$(field id "$CLIENT")"
echo "$CLIENT"

title "2. Uma mensagem para ocupar o worker, depois 2 normais e 5 urgentes"
send "ocupa o worker" normal >/dev/null
LABELS=(n1 n2 u1 u2 u3 u4 u5)
IDS=()
for label in "${LABELS[@]}"; do
  priority=normal; [[ $label == u* ]] && priority=urgent
  response="$(send "$label" "$priority")"
  IDS+=("$(field id "$response")")
  echo "  enviada $label ($priority)  custo R\$ $(field cost "$response")  saldo R\$ $(field currentBalance "$response")"
done

title "3. Fila logo após os envios (GET /queue/status)"
curl -fsS "$API/queue/status"; echo

title "4. Aguardando o worker esvaziar a fila"
until [[ "$(curl -fsS "$API/messages?status=delivered" -H "X-Client-Document: $DOCUMENT" | grep -o '"id"' | wc -l)" -ge 8 ]]; do
  printf '.'; sleep 0.5
done
echo

title "5. Ordem de entrega (pelo horário de 'delivered' no histórico de cada mensagem)"
ORDER="$(for i in "${!IDS[@]}"; do
  status="$(curl -fsS "$API/messages/${IDS[$i]}/status" -H "X-Client-Document: $DOCUMENT")"
  echo "$(sed -n 's/.*"status":"delivered","at":"\([^"]*\)".*/\1/p' <<<"$status") ${LABELS[$i]}"
done | sort | cut -d' ' -f2 | tr '\n' ' ')"
echo "  chegada: ${LABELS[*]}"
echo "  entrega: $ORDER"
echo "  (urgentes primeiro; a cada 3 urgentes seguidas, uma normal passa: nenhuma espera para sempre)"

title "6. Fila depois do processamento"
curl -fsS "$API/queue/status"; echo

title "7. Saldo zerado: o próximo envio é recusado antes de entrar na fila"
curl -fsS "$API/clients/$CLIENT_ID/balance"; echo
REFUSED="$(send "sem saldo" normal)"
echo "  HTTP $(tail -n1 <<<"$REFUSED")"
echo "  $(head -n1 <<<"$REFUSED")"

title "8. Extrato (GET /clients/:id/transactions)"
curl -fsS "$API/clients/$CLIENT_ID/transactions"; echo
