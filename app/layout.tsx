import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'StackForge by Enlight Lab — Describe it. Get the stack.',
  description:
    'Free infrastructure code generator. Answer a few questions and stream Terraform, CI/CD, and Kubernetes — how Enlight Lab builds.',
  icons: {
    icon: '/enlight-labs-logo.png',
    apple: '/enlight-labs-logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </head>
      <body className="min-h-screen antialiased">
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
