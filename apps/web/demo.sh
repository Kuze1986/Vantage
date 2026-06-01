#!/bin/bash

# Vantage Demo Walkthrough Shell Wrapper
# Simple script to run the demo with sensible defaults

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
VANTAGE_URL="${VANTAGE_DEMO_URL:-http://localhost:5173}"
EMAIL="${VANTAGE_DEMO_EMAIL:-}"
PASSWORD="${VANTAGE_DEMO_PASSWORD:-}"
OUTPUT_DIR="${DEMO_VIDEO_OUTPUT:-}"
HEADLESS="${DEMO_HEADLESS:-true}"

# Show usage
show_usage() {
  cat << EOF
${BLUE}Vantage Demo Walkthrough${NC}

Usage: ./demo.sh [OPTIONS]

Options:
  -u, --url URL           Base URL of Vantage instance
                          (default: http://localhost:5173)
                          (env: VANTAGE_DEMO_URL)

  -e, --email EMAIL       Login email
                          (required, or set VANTAGE_DEMO_EMAIL)

  -p, --password PASS     Login password
                          (required, or set VANTAGE_DEMO_PASSWORD)

  -o, --output DIR        Directory to save video file
                          (optional, env: DEMO_VIDEO_OUTPUT)

  --headed                Run browser in headed mode (for debugging)

  -h, --help              Show this help message

Examples:

  # Run with dev server
  VANTAGE_DEMO_EMAIL=demo@example.com \\
  VANTAGE_DEMO_PASSWORD=demo123 \\
  ./demo.sh

  # Run with custom URL and video output
  ./demo.sh \\
    --url https://app.vantage.example.com \\
    --email demo@example.com \\
    --password demo123 \\
    --output ./videos

  # Run in headed mode (see browser)
  ./demo.sh --email demo@example.com --password demo123 --headed

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -u|--url)
      VANTAGE_URL="$2"
      shift 2
      ;;
    -e|--email)
      EMAIL="$2"
      shift 2
      ;;
    -p|--password)
      PASSWORD="$2"
      shift 2
      ;;
    -o|--output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --headed)
      HEADLESS="false"
      shift
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_usage
      exit 1
      ;;
  esac
done

# Validate required fields
if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo -e "${RED}Error: Email and password are required${NC}"
  echo -e "${YELLOW}Set them via:${NC}"
  echo "  export VANTAGE_DEMO_EMAIL=user@example.com"
  echo "  export VANTAGE_DEMO_PASSWORD=securepass"
  echo -e "${YELLOW}Or pass them as arguments:${NC}"
  echo "  ./demo.sh --email user@example.com --password securepass"
  exit 1
fi

# Prepare environment
echo -e "${BLUE}🎬 Vantage Demo Walkthrough${NC}"
echo -e "${GREEN}URL:${NC} $VANTAGE_URL"
echo -e "${GREEN}Email:${NC} $EMAIL"
echo -e "${GREEN}Video output:${NC} ${OUTPUT_DIR:-none}"
echo -e "${GREEN}Headless mode:${NC} $HEADLESS"
echo ""

# Create output directory if specified
if [ ! -z "$OUTPUT_DIR" ]; then
  mkdir -p "$OUTPUT_DIR"
  echo -e "${YELLOW}📁 Videos will be saved to: $OUTPUT_DIR${NC}"
  echo ""
fi

# Set environment variables
export VANTAGE_DEMO_URL="$VANTAGE_URL"
export VANTAGE_DEMO_EMAIL="$EMAIL"
export VANTAGE_DEMO_PASSWORD="$PASSWORD"
export DEMO_VIDEO_OUTPUT="$OUTPUT_DIR"
export DEMO_HEADLESS="$HEADLESS"

# Run the demo
echo -e "${BLUE}▶️  Starting demo...${NC}"
npm run demo

# Check result
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Demo completed successfully!${NC}"
  if [ ! -z "$OUTPUT_DIR" ]; then
    echo -e "${GREEN}📹 Videos are in: $OUTPUT_DIR${NC}"
  fi
else
  echo -e "${RED}❌ Demo failed${NC}"
  exit 1
fi
