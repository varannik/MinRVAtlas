import { redirect } from "next/navigation";

/** Quality is now Cortex. The /quality/* console pages stay until Cortex has its own backend. */
export default function QualityIndexPage() {
  redirect("/cortex");
}
