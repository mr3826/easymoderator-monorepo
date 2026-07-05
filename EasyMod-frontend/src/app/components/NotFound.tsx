import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
      <h1 className="text-6xl font-bold text-foreground">404</h1>
      <p className="text-xl text-muted-foreground">We could not open this page.</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        The link may have changed. Go back to your dashboard or return home.
      </p>
      <Link
        to="/"
        className="mt-2 text-primary underline underline-offset-4 hover:opacity-80 transition-opacity"
      >
        Go back home
      </Link>
    </div>
  );
}
