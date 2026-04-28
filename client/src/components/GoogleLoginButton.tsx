import { useEffect, useEffectEvent, useRef } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number>
          ) => void;
        };
      };
    };
  }
}

type Props = {
  clientId: string;
  onCredential: (credential: string) => void;
};

export function GoogleLoginButton({ clientId, onCredential }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleCredential = useEffectEvent((credential: string) => {
    onCredential(credential);
  });

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !window.google || !containerRef.current) {
        return;
      }

      containerRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => handleCredential(credential)
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with'
      });
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existingScript) {
      render();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = render;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={containerRef} />;
}
