import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { App } from './App';
import { ChainProvider } from './chain/ChainProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChainProvider>
      <App />
    </ChainProvider>
  </StrictMode>,
);
