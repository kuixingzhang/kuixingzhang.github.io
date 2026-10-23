"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SiteHeader() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error("Unable to check login status:", error);
      }

      setUserId(data.session?.user.id ?? null);
      setCheckingAuth(false);
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUserId(session?.user.id ?? null);
      setCheckingAuth(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    if (signingOut) return;

    setSigningOut(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();

      if (error) throw error;

      setUserId(null);
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Sign out failed:", error);
      window.alert("Sign out failed. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="site-header">
      <div className="site-container header-inner">
        <Link className="brand" href="/">
          Dr. Zhang Pathology
        </Link>

        <nav className="nav-links" aria-label="Main navigation">
          <a href="/business-card.pdf" target="_blank" rel="noreferrer">
            Business Card
          </a>

          <a
            href="https://www.pathologygps.com"
            target="_blank"
            rel="noreferrer"
          >
            Pathology GPS ↗
          </a>

          <a
            href="https://www.xinghecaotang.com"
            target="_blank"
            rel="noreferrer"
          >
            星河草堂
          </a>

          {checkingAuth ? (
            <span className="nav-signin">Checking...</span>
          ) : userId ? (
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="nav-signin"
            >
              <LogOut
                size={15}
                style={{
                  display: "inline",
                  marginRight: 6,
                  verticalAlign: "middle",
                }}
              />
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/auth/login" className="nav-signin">
                Sign in
              </Link>

              <Link
                href="/auth/sign-up"
                className="rounded-lg bg-blue-700 px-4 py-2.5 text-white hover:bg-blue-800"
              >
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
