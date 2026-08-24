#!/bin/bash
# KneaChat Backend - Setup Script
# This script sets up the backend environment and database

set -e

# Run relative to the server directory even when invoked from the repository root.
script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir/.."

echo "╔════════════════════════════════════════════════════════╗"
echo "║    KneaChat Backend Setup Script                       ║"
echo "╚════════════════════════════════════════════════════════╝"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 16.0.0"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm >= 8.0.0"
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check if .env file exists
if [ ! -f .env ]; then
    echo ""
    echo "⚙️  Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please update .env with your database credentials"
    echo "⚠️  Edit: .env"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Update .env with your database credentials"
echo "  2. Initialize the database: npm run db:init"
echo "  3. Seed demo data:        npm run db:seed"
echo "  4. Start dev server:      npm run dev"
echo ""
echo "🌐 Server will run on: http://localhost:8080"
echo "📡 WebSocket on: ws://localhost:8080"
