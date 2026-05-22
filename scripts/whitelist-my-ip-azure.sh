#!/usr/bin/env bash
set -euo pipefail

# Whitelist current public IP in Azure.
# Default mode: add IP rule to Foundry/Cognitive Services accounts in Voice Translate PREPROD.
# Optional mode: create/update NSG inbound allow rule for current IP.

SUBSCRIPTION_ID="c663347b-d205-4500-a254-d3cbf905c626"
MODE="foundry"
DRY_RUN="false"

# Foundry/Cognitive Services filters
RESOURCE_GROUP=""
ACCOUNT_NAME=""

# NSG mode options
NSG_RESOURCE_GROUP=""
NSG_NAME=""
RULE_NAME="AllowMyPublicIP"
PRIORITY="310"
PORTS="443"

usage() {
  cat <<'EOF'
Usage:
  whitelist-my-ip-azure.sh [options]

Options:
  --subscription <id>     Azure subscription ID
                          default: c663347b-d205-4500-a254-d3cbf905c626 (Voice Translate PREPROD)
  --mode <foundry|nsg>    Whitelisting target type (default: foundry)
  --resource-group <rg>   Filter Foundry/Cognitive Services accounts by resource group
  --account <name>        Filter Foundry/Cognitive Services account by name
  --dry-run               Print commands without applying changes

NSG mode options:
  --nsg-rg <rg>           NSG resource group (required in nsg mode)
  --nsg <name>            NSG name (optional; if omitted, applies to all NSGs in --nsg-rg)
  --rule-name <name>      NSG rule name (default: AllowMyPublicIP)
  --priority <number>     NSG rule priority (default: 310)
  --ports "443 22"        Destination TCP ports (default: "443")

Examples:
  # Default: Voice Translate PREPROD Foundry/Cognitive Services accounts
  ./scripts/whitelist-my-ip-azure.sh

  # Only one Foundry account
  ./scripts/whitelist-my-ip-azure.sh --resource-group my-rg --account my-foundry-account

  # NSG mode for all NSGs in resource group
  ./scripts/whitelist-my-ip-azure.sh --mode nsg --nsg-rg az-gpo-euw-nprd-vtr-hub-rg1 --ports "443 22"

  # NSG mode for one NSG
  ./scripts/whitelist-my-ip-azure.sh --mode nsg --nsg-rg az-gpo-euw-nprd-vtr-aks1-nodes-rg1 --nsg aks-agentpool-18480241-nsg
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subscription)
      SUBSCRIPTION_ID="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --resource-group)
      RESOURCE_GROUP="$2"
      shift 2
      ;;
    --account)
      ACCOUNT_NAME="$2"
      shift 2
      ;;
    --nsg-rg)
      NSG_RESOURCE_GROUP="$2"
      shift 2
      ;;
    --nsg)
      NSG_NAME="$2"
      shift 2
      ;;
    --rule-name)
      RULE_NAME="$2"
      shift 2
      ;;
    --priority)
      PRIORITY="$2"
      shift 2
      ;;
    --ports)
      PORTS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd az
require_cmd curl

PUBLIC_IP="$(curl -fsSL https://api.ipify.org)"
if [[ ! "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Could not detect a valid public IPv4 address: $PUBLIC_IP" >&2
  exit 1
fi

SOURCE_CIDR="${PUBLIC_IP}/32"

echo "Subscription: $SUBSCRIPTION_ID"
echo "Mode: $MODE"
echo "Detected public IP: $PUBLIC_IP"

az account set --subscription "$SUBSCRIPTION_ID"

if [[ "$MODE" == "foundry" ]]; then
  echo "Searching Cognitive Services / Foundry accounts..."

  QUERY="[?kind=='OpenAI' || kind=='AIServices' || kind=='CognitiveServices'].[name,resourceGroup,kind]"
  ACCOUNTS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && ACCOUNTS+=("$line")
  done < <(az cognitiveservices account list --query "$QUERY" -o tsv)

  if [[ ${#ACCOUNTS[@]} -eq 0 ]]; then
    echo "No matching Cognitive Services accounts found in this subscription." >&2
    exit 1
  fi

  MATCHED=0
  for ROW in "${ACCOUNTS[@]}"; do
    NAME="$(awk '{print $1}' <<<"$ROW")"
    RG="$(awk '{print $2}' <<<"$ROW")"
    KIND="$(awk '{print $3}' <<<"$ROW")"

    if [[ -n "$RESOURCE_GROUP" && "$RG" != "$RESOURCE_GROUP" ]]; then
      continue
    fi
    if [[ -n "$ACCOUNT_NAME" && "$NAME" != "$ACCOUNT_NAME" ]]; then
      continue
    fi

    MATCHED=$((MATCHED + 1))
    printf '\nTarget account: %s (rg: %s, kind: %s)\n' "$NAME" "$RG" "$KIND"

    CMD=(az cognitiveservices account network-rule add --resource-group "$RG" --name "$NAME" --ip-address "$PUBLIC_IP" --only-show-errors)
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "DRY RUN: ${CMD[*]}"
    else
      "${CMD[@]}"
      echo "Added/updated IP rule: $PUBLIC_IP"
      echo "Current allowed IPs:"
      az cognitiveservices account show --resource-group "$RG" --name "$NAME" --query "properties.networkAcls.ipRules[].value" -o tsv || true
    fi
  done

  if [[ $MATCHED -eq 0 ]]; then
    echo "No accounts matched provided filters." >&2
    exit 1
  fi

  printf '\nDone. Whitelisting complete for %s account(s).\n' "$MATCHED"
  exit 0
fi

if [[ "$MODE" == "nsg" ]]; then
  if [[ -z "$NSG_RESOURCE_GROUP" ]]; then
    echo "--nsg-rg is required in nsg mode." >&2
    exit 1
  fi

  PORT_ARRAY=()
  read -r -a PORT_ARRAY <<<"$PORTS"

  NSGS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && NSGS+=("$line")
  done < <(
    if [[ -n "$NSG_NAME" ]]; then
      printf '%s\n' "$NSG_NAME"
    else
      az network nsg list --resource-group "$NSG_RESOURCE_GROUP" --query "[].name" -o tsv
    fi
  )

  if [[ ${#NSGS[@]} -eq 0 ]]; then
    echo "No NSGs found for resource group: $NSG_RESOURCE_GROUP" >&2
    exit 1
  fi

  for NSG in "${NSGS[@]}"; do
    printf '\nTarget NSG: %s (rg: %s)\n' "$NSG" "$NSG_RESOURCE_GROUP"

    CMD=(
      az network nsg rule create
      --resource-group "$NSG_RESOURCE_GROUP"
      --nsg-name "$NSG"
      --name "$RULE_NAME"
      --priority "$PRIORITY"
      --direction Inbound
      --access Allow
      --protocol Tcp
      --source-address-prefixes "$SOURCE_CIDR"
      --source-port-ranges "*"
      --destination-address-prefixes "*"
      --destination-port-ranges
    )
    CMD+=("${PORT_ARRAY[@]}")
    CMD+=(--only-show-errors)

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "DRY RUN: ${CMD[*]}"
    else
      "${CMD[@]}" >/dev/null
      echo "Rule ensured: $RULE_NAME ($SOURCE_CIDR -> ports: $PORTS)"
    fi
  done

  printf '\nDone. Whitelisting complete for %s NSG(s).\n' "${#NSGS[@]}"
  exit 0
fi

echo "Unsupported mode: $MODE" >&2
usage
exit 1
