#!/bin/bash

# Maigun Setup Script
# This script helps you set up Maigun locally or for Render deployment

set -e

echo "==================================="
echo "Maigun Campaign Studio Setup"
echo "==================================="
echo ""

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. You have $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# Install root dependencies
echo ""
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd backend
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo ""
    echo "⚠️  Please update backend/.env with your Mailgun credentials:"
    echo "   - MAILGUN_API_KEY"
    echo "   - MAILGUN_DOMAIN"
    echo ""
    echo "Then run: npm run db:push"
fi

# Try to setup database
if [ -z "$DATABASE_URL" ] && grep -q "postgresql://" .env; then
    echo ""
    echo "🗄️  Setting up database..."
    npm run db:generate
    
    # Check if we can connect to database
    if npm run db:push 2>/dev/null; then
        echo "✅ Database configured successfully"
    else
        echo "⚠️  Could not connect to database. Make sure DATABASE_URL is set correctly."
        echo "   For Render deployment, you'll set this after creating the PostgreSQL service."
    fi
fi

cd ..

echo ""
echo "=== Setup Complete ==="
echo ""
echo "📚 Next steps:"
echo ""
echo "1. Local Development:"
echo "   Terminal 1: cd backend && npm run dev"
echo "   Terminal 2: npm run dev"
echo ""
echo "2. Production Deployment (Render):"
echo "   See SETUP_RENDER.md for detailed instructions"
echo ""
echo "3. Environment Variables:"
echo "   - Frontend: Create .env.local in root"
echo "   - Backend: Update backend/.env"
echo ""
