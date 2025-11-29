'use client';

import { Dispatch, SetStateAction } from 'react';

type AuthUser = { id: string; username: string } | null;

type HeaderProps = {
  authUser: AuthUser;
  authUsername: string;
  authPassword: string;
  authMode: 'login' | 'register';
  onAuth: () => void;
  onLogout: () => void;
  setAuthUsername: Dispatch<SetStateAction<string>>;
  setAuthPassword: Dispatch<SetStateAction<string>>;
  toggleAuthMode: () => void;
  brandLabel?: string;
};

export const Header = ({
  authUser,
  authUsername,
  authPassword,
  authMode,
  onAuth,
  onLogout,
  setAuthUsername,
  setAuthPassword,
  toggleAuthMode,
  brandLabel = 'Регламентер',
}: HeaderProps) => {
  return (
    <div className="p-3 border-b bg-muted/5">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">{brandLabel}</div>
        <div>
          {authUser ? (
            <div className="flex items-center gap-3">
              <div className="text-sm">
                Signed in as <strong>{authUser.username}</strong>
              </div>
              <button onClick={onLogout} className="text-sm px-2 py-1 border rounded">
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="border px-2 py-1 rounded text-sm"
                placeholder="Username"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
              />
              <input
                className="border px-2 py-1 rounded text-sm"
                type="password"
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
              <button
                onClick={toggleAuthMode}
                className="text-sm px-2 py-1 border rounded"
              >
                {authMode === 'login' ? 'Register' : 'Login'}
              </button>
              <button
                onClick={onAuth}
                className="text-sm px-3 py-1 bg-primary text-black rounded"
              >
                {authMode === 'login' ? 'Login' : 'Create'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
