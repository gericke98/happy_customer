# AI Customer Support Chat

A real-time customer support chat application with AI-powered responses, built with Next.js 14, React, TypeScript, and PostgreSQL.

## Database Setup

This application uses PostgreSQL with Drizzle ORM. Follow these steps to set up the database:

### Local Development

1. Create a `.env` file in the root directory with your database connection string:

   ```
   DATABASE_URL=postgres://username:password@localhost:5432/database_name
   ```

2. Run the migrations to create the database schema:
   ```bash
   npm run migrate
   ```

### Production Deployment

When deploying to Vercel, make sure to:

1. Add the `DATABASE_URL` environment variable in your Vercel project settings.
2. The postbuild script will automatically run migrations during deployment.

If you encounter database errors after deployment, you can manually run migrations:

1. Install the Vercel CLI:

   ```bash
   npm install -g vercel
   ```

2. Pull environment variables:

   ```bash
   vercel env pull
   ```

3. Run migrations:
   ```bash
   npm run migrate:mjs
   ```

Alternatively, you can run migrations directly in the Vercel console:

1. Go to your project in the Vercel dashboard
2. Navigate to Settings > Functions > Console
3. Run the following command:
   ```bash
   node db/migrate.mjs
   ```

## Development

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Features

- Real-time customer support chat
- AI-powered responses
- Order tracking and management
- Delivery address changes
- Returns and exchanges
- Admin takeover for complex issues

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
