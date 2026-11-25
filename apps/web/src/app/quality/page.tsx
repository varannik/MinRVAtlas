import { redirect } from "next/navigation";

/** The console is Sentinel's document V&V now; data quality is the quality engine's, on the calculation tree. */
export default function QualityIndexPage() {
  redirect("/quality/vv");
}
