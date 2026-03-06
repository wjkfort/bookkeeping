#!/bin/bash
# Test AI transaction creation
curl -X POST http://localhost:8787/api/v1/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "I spent 150 CNY to buy a glass today, add this for me",
    "include_context": true
  }' | jq .
