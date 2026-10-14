import { redirect } from "next/navigation";

// `/` opens the app; the proxy signs people in first.
export default function Home() {
  redirect("/overview");
}
