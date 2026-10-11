import { redirect } from "next/navigation";

// The public landing page replaces this in A4c; until then `/` opens the app (the proxy signs people in first).
export default function Home() {
  redirect("/overview");
}
