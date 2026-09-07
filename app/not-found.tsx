import Link from "next/link";
import { VEHICLES } from "../lib/data/vehicles";

/**
 * 404 page.
 *
 * Reached for any path outside `generateStaticParams`' pre-rendered set — most often a mistyped or
 * stale vehicle slug, since `/[slug]` is the app's main route shape and slugs change as the
 * catalog does. Listing the real vehicles turns the dead end into the navigation the user was
 * looking for, which is worth more here than a styled apology: the set is small, known at build
 * time, and exactly what they were trying to reach.
 */
export default function NotFound() {
  return (
    <main className="route-error">
      <h1>Page not found</h1>
      <p>That page does not exist. These vehicles do:</p>
      <ul className="not-found-vehicles">
        {VEHICLES.map((vehicle) => (
          <li key={vehicle.slug}>
            <Link href={`/${vehicle.slug}`}>
              {vehicle.year} {vehicle.model}
            </Link>
          </li>
        ))}
      </ul>
      <div className="route-error-actions">
        <Link className="ghost" href="/explore">
          Explore the full lineup
        </Link>
      </div>
    </main>
  );
}
