import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/components/layout.css';
import './styles/components/sidebar.css';
import './styles/components/viewer.css';
import './styles/components/editor.css';
import './styles/global.css';
import './styles/variables.css';

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations: readonly ServiceWorkerRegistration[]): void => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}

const savedTheme: string = localStorage.getItem('draw-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt: number): number => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: true,
    },
  },
});

const rootElement: HTMLElement | null = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
