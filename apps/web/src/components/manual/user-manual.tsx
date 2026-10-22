import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Globe2, Landmark, ShieldCheck } from "lucide-react";

const CONTENTS: { id: string; label: string }[] = [
  { id: "start", label: "Start here" },
  { id: "what", label: "What MinRV is for" },
  { id: "screens", label: "The three screens" },
  { id: "who", label: "Who uses which screen" },
  { id: "map", label: "The map" },
  { id: "numbers", label: "Numbers on the map" },
  { id: "portfolio", label: "The portfolio list" },
  { id: "create-isometric", label: "Creating an Isometric project" },
  { id: "puro", label: "Puro.earth" },
  { id: "open", label: "Opening a project" },
  { id: "setup", label: "Project setup" },
  { id: "chain", label: "Capture, transport, storage" },
  { id: "period", label: "Filing a reporting period" },
  { id: "quality", label: "Quality Console" },
  { id: "protocols", label: "Protocol Manager" },
  { id: "knowledge", label: "Knowledge base" },
  { id: "vv", label: "V&V projects" },
  { id: "ledger", label: "Ledger" },
  { id: "walkthrough", label: "BioCCS and DAC, end to end" },
  { id: "limits", label: "What this workspace cannot do yet" },
  { id: "words", label: "Words" },
];

export function UserManual() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-off-white text-frost">
      <header className="sticky top-0 z-20 border-b border-line bg-off-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto px-5 py-3">
          <Link href="/manual" className="flex shrink-0 items-center gap-2 text-sm font-semibold whitespace-nowrap">
            <BookOpen className="size-4 text-carbon-400" />
            User guide
          </Link>
          <nav className="ml-auto flex shrink-0 items-center gap-4 text-xs text-mist">
            <Link href="/" className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-frost">
              <Globe2 className="size-3.5" />
              Back to map
            </Link>
            <Link href="/quality" className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-frost">
              <ShieldCheck className="size-3.5" />
              Quality
            </Link>
            <Link
              href="/ledger?tab=overview&registry=isometric"
              className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-frost"
            >
              <Landmark className="size-3.5" />
              Ledger
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:sticky lg:top-20 lg:block lg:self-start" aria-label="On this page">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-mist uppercase">
            On this page
          </p>
          <ol className="mt-3 space-y-1.5 text-[13px]">
            {CONTENTS.map((item, index) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="text-mist hover:text-frost">
                  <span className="mr-2 tabular text-[11px] text-sand">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 max-w-3xl space-y-14 pb-24">
          <header>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-carbon-400 uppercase">
              MinRV · 44.01
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              How to work in MinRV
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-mist">
              This guide is for people reviewing and operating removal projects.
              It is written for biomass carbon capture and storage (BioCCS — on
              Isometric the capture pathway is called BiCRS) and for direct air
              capture (DAC), including geological storage such as in-situ
              mineralisation. The worked example on the map is Fujairah
              Peridotite Mineralisation.
            </p>
            <details className="mt-6 rounded-2xl bg-white px-4 py-3 ring-1 ring-line lg:hidden">
              <summary className="cursor-pointer text-[12px] font-semibold tracking-[0.14em] text-mist uppercase">
                On this page
              </summary>
              <ol className="mt-3 space-y-1.5 text-[13px]">
                {CONTENTS.map((item, index) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="text-mist hover:text-frost">
                      <span className="mr-2 tabular text-[11px] text-sand">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </details>
          </header>

          <Section id="start" title="Start here">
            <p>
              If you have just signed in and the globe is the only thing that
              makes sense, use this table. Each row is a question from the
              October 2026 review, and the section that answers it.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
              <table className="w-full min-w-[36rem] text-left text-[13px]">
                <thead className="border-b border-line text-[10px] tracking-[0.14em] text-mist uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">You wanted to know</th>
                    <th className="px-4 py-3 font-semibold">Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/80">
                  <Row q="How do I move around, and what is each control for?" href="#map" />
                  <Row q="Why can I not see every registry at once?" href="#map" />
                  <Row q="What do the numbers beside the globe mean, including periods in flight?" href="#numbers" />
                  <Row q="What does “periods” mean on a project, and what is the progress bar?" href="#portfolio" />
                  <Row q="How do I create a new project?" href="#create-isometric" />
                  <Row q="I do not have an Isometric sandbox login." href="#create-isometric" />
                  <Row q="How do I create a Puro project?" href="#puro" />
                  <Row q="I opened a project and there is too much on the screen." href="#open" />
                  <Row q="Where do I upload protocol data, and when?" href="#chain" />
                  <Row q="What is Quality, and who is it for?" href="#quality" />
                  <Row q="Why are cookstoves, biochar, and avoided deforestation in Quality?" href="#protocols" />
                  <Row q="What is a checkpoint, and what does critical mean?" href="#protocols" />
                  <Row q="What do ESS, severity, and active mean in the knowledge base?" href="#knowledge" />
                  <Row q="What is a V&V project, and can I delete one?" href="#vv" />
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="what" title="What MinRV is for">
            <p>
              MinRV is the workspace where 44.01 prepares evidence, checks that
              the files are fit to file, and reads the credits a registry has
              already issued. A project developer uses it to manage the path to
              issuance. The issuing body still owns the decision to validate the
              design and to issue the credit.
            </p>
            <p>
              Isometric’s product for that decision is Certify. Puro’s product
              is MyPuro and the Puro Registry. MinRV talks to Certify for the
              organisation it is connected to. It does not replace either
              registry’s own screens for creating an account, requesting
              validation, or appointing an auditor.
            </p>
            <Callout>
              Two clocks, always. The first clock is validation: prove the
              design once (site, permits, project design, life-cycle
              assessment). The second clock is verification: prove the numbers
              for one reporting period (monitoring files, a GHG entry, a GHG
              statement). You file the second clock only after the first has a
              home in Certify.
            </Callout>
          </Section>

          <Section id="screens" title="The three screens">
            <p>After you sign in you are on the map. Everything else hangs off it.</p>
            <ul className="mt-4 space-y-3">
              <Place
                name="Map"
                href="/"
                who="Project developers, commercial, and technical reviewers."
                detail="Find a project, read its design summary, and file the current reporting period. The button in the top bar is labelled dMRV Atlas until a project is open. After a project is open, that same button shows the project name and returns you to the map."
              />
              <Place
                name="Quality"
                href="/quality"
                who="Technical and digital MRV staff who configure checks."
                detail="Rules, document checkpoints, datasets, and run history. Open it from Quality in the top bar. Return with Back to map at the bottom of the Quality menu, or with this guide’s Back to map link."
              />
              <Place
                name="Ledger"
                href="/ledger?tab=overview&registry=isometric"
                who="Anyone tracking issued, delivered, or retired tonnes."
                detail="Inventory that already exists at the registry. A project with no issued credits has nothing to retire here."
              />
            </ul>
            <p>
              This guide stays available from Guide on the map, from User guide
              in Quality, and from Guide on the ledger. Sign out is the door
              icon on the map, or Sign out in Quality and on the ledger.
            </p>
          </Section>

          <Section id="who" title="Who uses which screen">
            <p>
              Quality is a specialist console. A commercial reviewer and a
              project developer can ignore it until a file fails a check.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
              <table className="w-full min-w-[36rem] text-left text-[13px]">
                <thead className="border-b border-line text-[10px] tracking-[0.14em] text-mist uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3 font-semibold">Start on</th>
                    <th className="px-4 py-3 font-semibold">Leave alone until asked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/80 text-mist">
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Project developer</td>
                    <td className="px-4 py-3">Map, then the open project</td>
                    <td className="px-4 py-3">Protocol Manager, knowledge base, models</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Commercial</td>
                    <td className="px-4 py-3">Map numbers, then Ledger</td>
                    <td className="px-4 py-3">Quality, except a report someone sends you</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Technical / MRV</td>
                    <td className="px-4 py-3">Map for the filing, Quality for the checks</td>
                    <td className="px-4 py-3">Ledger transfers and retirement</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">External auditor</td>
                    <td className="px-4 py-3">The registry’s own review, in Certify or Puro</td>
                    <td className="px-4 py-3">MinRV is an internal pre-check, not the auditor’s login</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="map" title="The map">
            <p>
              The globe is the portfolio. Drag to turn it. Click a pin to open
              that project. The search in the centre matches project name,
              country, or methodology.
            </p>
            <h3 className="mt-6 text-base font-semibold">What each control is for</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>
                <strong className="font-medium text-frost">dMRV Atlas</strong> opens
                the portfolio drawer, the list of projects. Click the shaded area,
                or press Escape, to close it.
              </li>
              <li>
                <strong className="font-medium text-frost">Registry menu</strong>{" "}
                (Isometric or Puro.earth) filters that list. The map opens on
                Isometric, because that is the registry this workspace can read
                live. There is no combined “all registries” view. Verra and Gold
                Standard are not connected, so cookstove and forestry projects
                from those programmes do not appear for 44.01.
              </li>
              <li>
                <strong className="font-medium text-frost">Search</strong> narrows
                the same list and the pins.
              </li>
              <li>
                <strong className="font-medium text-frost">Guide, Ledger, Quality</strong>{" "}
                leave the map. They do not change the selected project.
              </li>
              <li>
                <strong className="font-medium text-frost">The pulsing dot</strong>{" "}
                means the page is live. It is not a sensor alarm.
              </li>
            </ul>
            <p>
              Choosing Puro.earth does not create a Puro account. It shows Puro
              projects already in this workspace. For 44.01 that list is empty
              until a facility is connected. Switch the menu back to Isometric
              to see Fujairah and any other Certify project the connection can
              read.
            </p>
          </Section>

          <Section id="numbers" title="Numbers on the map">
            <p>
              Four tiles sit beside the globe while you are on the map. They
              sum the projects in the current registry filter, so switching
              from Isometric to Puro.earth changes the totals. Opening a
              project hides the tiles. That project’s own figures are on its
              row in the portfolio list and, once credits exist, on the ledger.
            </p>
            <dl className="mt-4 space-y-4">
              <Def
                term="Credits issued to date"
                meaning="Tonnes the registry has already issued on the projects in view, in tCO₂e. This is the issuance total."
              />
              <Def
                term="Forecast annual removals"
                meaning="The expected yearly removal on those same projects, in tCO₂e per year. It is a forecast, not a credit."
              />
              <Def
                term="Live sensor streams"
                meaning="A count of metering devices recorded on the project. It tells a technician how much instrumentation is attached. It is not an issuance figure, and a project developer can ignore it when the question is how many credits exist."
              />
              <Def
                term="Periods in flight"
                meaning="How many reporting windows are still open. A reporting window is one monitoring period: the stretch of operations you will put on a single GHG statement. “In flight” means that window is not yet issued. It is not the crediting period. The crediting period is the multi-year span the registry grants, often several years, inside which those windows sit."
              />
            </dl>
            <p>
              Retired tonnes are not on these tiles. Open Ledger, then Retire
              or Activity, for tonnes that have been retired. The portfolio
              header shows how many projects are in the current filter.
            </p>
          </Section>

          <Section id="portfolio" title="The portfolio list">
            <p>
              Open dMRV Atlas. Each row is one project on one registry. A
              project never belongs to two registries.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>
                <strong className="font-medium text-frost">The coloured dot</strong>{" "}
                is status: draft, validation, monitoring, verification, or issued.
              </li>
              <li>
                <strong className="font-medium text-frost">API</strong> means
                requirements are being read from that registry.{" "}
                <strong className="font-medium text-frost">CERTIFY</strong> means
                the row was listed from Isometric Certify with the organisation’s
                credentials. <strong className="font-medium text-frost">LIVE</strong>{" "}
                on an open Isometric project means the monitoring list came from
                Certify. <strong className="font-medium text-frost">BUNDLED</strong>{" "}
                means MinRV is showing its packaged rulebook because the live
                list did not load.
              </li>
              <li>
                <strong className="font-medium text-frost">“3 periods”</strong>{" "}
                means three reporting windows (monitoring periods), not a
                three-year crediting period. The crediting period is agreed in
                the registry and is not this count.
              </li>
              <li>
                <strong className="font-medium text-frost">The bar and the percentage</strong>{" "}
                are how much of the latest open window’s requirement list is
                ready. They are not forecast versus issued versus retired.
              </li>
              <li>
                <strong className="font-medium text-frost">“6.4k issued”</strong>{" "}
                is credits already issued on that project.
              </li>
            </ul>
            <p>
              There is no New project button on this list. The next section is
              why, and what to do instead.
            </p>
          </Section>

          <Section id="create-isometric" title="Creating an Isometric project">
            <p>
              You create the project in Isometric Certify. MinRV then lists it.
              Certify’s create-project screen is not reproduced here: the MinRV
              connection can read the project, file design evidence, and file a
              period, after the project already has a Certify id (it looks like{" "}
              <code className="rounded bg-ink-700 px-1 py-px font-mono text-[12px]">prj_…</code>
              ).
            </p>
            <h3 className="mt-6 text-base font-semibold">If you do not have a sandbox login</h3>
            <p>
              You do not need a personal Certify sandbox password to review a
              project that is already on the map. The sandbox is a practice
              copy of Certify. Its keys sit on the MinRV server for the 44.01
              organisation. Your browser never holds them. Signing in to MinRV
              is enough to open Fujairah, read the charter, and work a period
              on that connection.
            </p>
            <p>
              You do need a Certify user, granted by Isometric, if the project
              does not exist yet and you are the person who must click Create
              project, run Remi’s pre-review, or press Request validation. Ask
              the 44.01 operator to either create the project in the Certify
              organisation this environment uses, or to request a Certify login
              for you. When it exists, refresh the map. It appears under
              Isometric with a CERTIFY mark. If it does not appear, it is not
              in the organisation MinRV is connected to — creating it in a
              different Certify account will not list it here.
            </p>
            <h3 className="mt-6 text-base font-semibold">What to enter in Certify</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Short title, a description, and the country. Leave the protocol name out of the title.</li>
              <li>
                Choose the pathway and the capture protocol. For this workspace
                that is Direct Air Capture, or BiCRS for BioCCS. Isometric treats
                the capture protocol and the storage module as two choices.
              </li>
              <li>
                Tick the storage module that matches the site. For rock storage
                of the Fujairah type, that is CO₂ storage via in-situ
                mineralisation in mafic and ultramafic formations. The module
                is not a second project.
              </li>
              <li>Create the project, then add the storage site (the formation, not a field).</li>
              <li>
                Return to MinRV. Open the project from the portfolio or its pin.
                Continue in Project setup, below.
              </li>
            </ol>
            <Callout>
              DAC and BioCCS projects on Isometric do not use biochar durability
              settings, cookstove usage surveys, or avoided-deforestation plots.
              If a screen offers those, you are in the wrong protocol.
            </Callout>
          </Section>

          <Section id="puro" title="Puro.earth">
            <p>
              MinRV cannot create a Puro project. Puro has no sandbox wired to
              this workspace, and the ledger’s Puro option is switched off.
            </p>
            <p>
              A Puro facility is registered in MyPuro after the supplier has
              signed the platform agreement and completed facility registration.
              Only then can a dMRV partner be granted access. The stages MinRV
              would eventually help with are the audit package and the output
              report. Account opening, the annual fee, and CORC issuance stay
              in Puro’s own registry.
            </p>
            <p>
              Until that connection exists, leave the registry menu on
              Isometric for real work. Puro biochar checkpoints inside Quality
              are a library shipped with the checking engine. They are not a
              Puro project, and they are not the pathway for 44.01 BioCCS or
              DAC. The document checks that match 44.01’s geological storage
              shape are the CCS checkpoints (capture, transport, and permanent
              mineralisation), which a technical user selects on purpose inside
              a V&V pack.
            </p>
          </Section>

          <Section id="open" title="Opening a project">
            <p>
              Click the row, or the pin. The map stays behind two panels. Read
              them as two jobs.
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>
                <strong className="font-medium text-frost">Left: Project charter.</strong>{" "}
                The design, filed once. The stamp says whether Certify already
                holds it: “Charter not on file”, “Definition in progress”, or
                “Definition sealed”. Open setup is the button that files design
                evidence. Reporting-period files do not belong in this column.
              </li>
              <li>
                <strong className="font-medium text-frost">Centre: the period desk.</strong>{" "}
                One reporting window. The large percentage is that window’s
                readiness, not the life of the project. The code at the top is
                the window’s id. The ribbon across the top of the screen is the
                chain of windows. Click another block, or use the left and right
                arrow keys, to move along it.
              </li>
            </ol>
            <p>
              To leave the project, click the project name at the top left (it
              shows a small globe) or press Escape. That returns you to the map.
              Escape also closes setup, a requirement, and the portfolio, in
              that order, before it leaves the project.
            </p>
            <h3 className="mt-6 text-base font-semibold">How to review without reading everything</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Read the charter stamp. If the design is incomplete, stay on the left and open setup. Ignore the centre until the design exists.</li>
              <li>If the design is in progress or sealed, the centre is the current window’s carbon accounting. You are on the second clock.</li>
              <li>
                The centre has four tabs. Use one of them:
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><strong className="font-medium text-frost">GHG entry data</strong> — this window’s measured numbers, and the quality check on that file.</li>
                  <li><strong className="font-medium text-frost">GHG statements</strong> — the folder for the window, plus the list of monitoring files still due.</li>
                  <li><strong className="font-medium text-frost">Project emissions</strong> — one-off construction and end-of-life emissions. Read-only. They are created on the LCA in Certify.</li>
                  <li><strong className="font-medium text-frost">LCA</strong> — the recipe Certify holds. Read-only. You do not upload this month’s CSV here.</li>
                </ul>
              </li>
            </ol>
            <p>
              The charter badge in the top bar (Defined, Charter, or No charter)
              opens setup directly. It appears only for Isometric projects.
            </p>
          </Section>

          <Section id="setup" title="Project setup">
            <p>
              Open setup from the charter, or from the charter badge. The strip
              at the top is the validation clock: Draft, Pre-screen, VVB Review,
              Validated. After VVB review the design locks.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>
                <strong className="font-medium text-frost">Design</strong> is the
                project design checklist from Certify: protocol, environmental
                and social safeguards, stakeholder input, and pathway-specific
                rows. For each row, write the answer and upload the source
                (permit, lab, model, seismic study) with Upload to Certify.
              </li>
              <li>
                <strong className="font-medium text-frost">Storage sites</strong>{" "}
                is the geological formation. Add the site in Certify if it is
                missing, then attach geometry or monitoring evidence here.
                Monitoring submissions need a site first.
              </li>
              <li>
                <strong className="font-medium text-frost">Feedstocks</strong> and{" "}
                <strong className="font-medium text-frost">Field measurements</strong>{" "}
                appear for pathways that use them. A DAC or in-situ
                mineralisation project uses Design and Storage sites.
              </li>
            </ul>
            <p>
              The life-cycle assessment is built in Certify, then converted into
              a GHG entry template. MinRV shows that template and does not let
              you redraw it. Remi, the public comment period, and Request
              validation stay in Certify. When the template exists, the period
              desk can accept a GHG entry. Until then the GHG entry tab says no
              template is on file, and the correct next step is in Certify, not
              another upload on the map.
            </p>
          </Section>

          <Section id="chain" title="Capture, transport, and storage">
            <p>
              The map does not give you three folders named Capture, Transport,
              and Storage. The split is the one Isometric uses, and it is where
              each file goes.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
              <table className="w-full min-w-[40rem] text-left text-[13px]">
                <thead className="border-b border-line text-[10px] tracking-[0.14em] text-mist uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Part of the chain</th>
                    <th className="px-4 py-3 font-semibold">When you provide it</th>
                    <th className="px-4 py-3 font-semibold">Where in MinRV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/80 text-mist">
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Capture pathway</td>
                    <td className="px-4 py-3">Once, at project creation, then inside the LCA</td>
                    <td className="px-4 py-3">Chosen in Certify (DAC or BiCRS). The design answers are filed under Setup → Design. The maths is the LCA tab.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Energy and transport</td>
                    <td className="px-4 py-3">Factors once on the LCA. This period’s kWh, fuel, and distances on each GHG entry</td>
                    <td className="px-4 py-3">GHG entry data. They are components of the template, not a separate transport project.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Storage</td>
                    <td className="px-4 py-3">The site once. Well integrity, pressure, tracers, and similar evidence every window they fall due</td>
                    <td className="px-4 py-3">Setup → Storage sites for the formation. GHG statements → Monitoring coverage for the files due this window.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-frost">Net removal</td>
                    <td className="px-4 py-3">Every reporting window, after the template exists</td>
                    <td className="px-4 py-3">GHG entry data, then GHG statements.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              A pressure export is monitoring evidence. A CSV of this period’s
              measured inputs is a GHG entry source. A written net-tonne
              workbook is not a substitute for either. Upload each one on the
              row that names it.
            </p>
          </Section>

          <Section id="period" title="Filing a reporting period">
            <h3 className="text-base font-semibold">Monitoring evidence</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Open the project and select the window on the ribbon.</li>
              <li>Open the GHG statements tab.</li>
              <li>Under Monitoring coverage, click the requirement that is due. The panel on the right is that requirement only.</li>
              <li>Drop the file, add a short note (instrument, lab, or why this file belongs here), and click Run quality check.</li>
              <li>When the checks pass, click Submit to Certify. Nothing is sent to Certify by the quality check itself. A failed check cannot be submitted.</li>
            </ol>
            <h3 className="mt-6 text-base font-semibold">The GHG entry</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Stay on the same window. Open GHG entry data.</li>
              <li>If the panel says there is no template, stop and finish the LCA in Certify. Convert Project operations into a template, then come back.</li>
              <li>Upload a CSV for this entry, or fetch the stream already stored for these dates. Both go through the same quality check.</li>
              <li>Click Run quality check. The review walks data quality, anomaly, and the registry arithmetic. Correct a cell if you are asked to, and run it again.</li>
              <li>Fill every monitored input the template still wants (this period’s energy, injected or isolated mass, and so on). Factors that are fixed live on the LCA and are already bound.</li>
              <li>Create the GHG entry only after the check has passed and those inputs are filled.</li>
            </ol>
            <h3 className="mt-6 text-base font-semibold">The statement</h3>
            <p>
              On GHG statements, click Create GHG statement. Certify pulls in
              GHG entries whose completed-on date falls in the window. Periods
              have to stay contiguous: the start is inferred from the previous
              statement or the earliest entry. The statement is the package a
              verifier reads. Submitting it for verification, and the verifier’s
              decision, finish in Certify.
            </p>
          </Section>

          <Section id="quality" title="Quality Console">
            <p>
              Quality checks whether a table or a document is fit to file. It
              does not create a registry project, and it does not issue a
              credit. Open it when you are configuring those checks or
              inspecting a run. A project developer who only needs to attach
              this month’s file can stay on the map and use Run quality check
              on that file.
            </p>
            <p>
              The first control is the Project menu in the header. Pages stay
              empty until you select a project. The menu lists the same
              projects as the map. Selecting one connects it to the checking
              engine for this session.
            </p>
            <p>The left menu is three groups:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>
                <strong className="font-medium text-frost">Configure</strong> —
                Rule Manager, correction tools, Protocol Manager, models,
                knowledge base, V&V projects. This is where a technical owner
                decides what “good” looks like.
              </li>
              <li>
                <strong className="font-medium text-frost">Operate</strong> —
                Datasets, DQA runs, violations, the workbench, anomaly, and
                schedules. This is where a file is uploaded on its own, a run
                is inspected, and a suggested correction is accepted or
                rejected. Use it after a check on the map, or when you want to
                test a file before it is attached to a requirement.
              </li>
              <li>
                <strong className="font-medium text-frost">Compliance</strong> —
                the audit trail and downloadable reports.
              </li>
            </ul>
            <p>
              A practical sequence for a technical owner on a BioCCS or DAC
              project:
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Select the project.</li>
              <li>On Rule Manager, if the list is empty, click Seed CO₂ rules. Those defaults are CO₂ removal checks. They do not enrol you in a forestry methodology.</li>
              <li>On the map, run the check from the requirement or the GHG entry. Open DQA runs and Violations when you need the detail.</li>
              <li>Use the workbench only when the run offers a correction to approve or reject.</li>
              <li>Export from Reports when someone outside the console needs the result.</li>
            </ol>
            <p>
              Back to map is at the bottom of the Quality menu. User guide is
              directly above it.
            </p>
          </Section>

          <Section id="protocols" title="Protocol Manager">
            <p>
              The protocol and the storage module are chosen in Certify when
              the project is created. Protocol Manager does not make that
              choice, and changing a row here does not retarget Fujairah from
              DAC to something else.
            </p>
            <p>
              Protocol Manager lists document-check libraries held by the
              quality engine: named sets of checkpoints a V&V pack can score a
              PDF against. A checkpoint is one question in that library (“is
              the offtake agreement present?”, “is the monitoring plan
              present?”). It is not an Isometric module. Modules travel with
              the Certify project and show up as monitoring requirements on the
              period desk.
            </p>
            <p>
              <strong className="font-medium text-frost">Critical</strong> means
              a failed checkpoint fails the document pack. The engine treats the
              pack as not verified while any critical checkpoint has failed. A
              standard checkpoint is still reviewed; on its own it does not
              fail the pack. Several ordinary gaps together can still leave the
              pack conditional.
            </p>
            <p>
              The engine currently also holds libraries for methodologies 44.01
              is not operating, including biochar, cookstoves, and
              avoided-deforestation rulesets from other programmes. Those names
              are not projects on your map, and they are not an instruction to
              integrate those pathways. For this workspace, select a protocol
              only when you are building a document pack for BioCCS (BiCRS),
              DAC, or geological storage, and prefer the full name and version
              shown on the row (for example a Puro CCS geological-storage pack,
              or the Isometric protocol version already on the project). Leave
              the others unselected. Removing them from the engine is a product
              change, separate from using the project.
            </p>
          </Section>

          <Section id="knowledge" title="Knowledge base">
            <p>
              The knowledge base is a list of short operational recommendations
              the checking engine can attach to an anomaly (“inspect the
              compressor”, “check the flow meter calibration”). It is not the
              project design, and it is not a methodology catalogue you must
              complete.
            </p>
            <dl className="mt-4 space-y-4">
              <Def
                term="Domain"
                meaning="Which operation the note was written for. ccs is the relevant domain for injection and mineralisation. biochar notes are seeded examples for a pathway this workspace is not operating. You can leave them unused."
              />
              <Def
                term="ESS"
                meaning="Environmental and social safeguards. The seeded line “Verify ESS monitoring continuity” means: if environmental monitoring has a gap, report it. ESS is not a separate MinRV module and not a protocol you select at setup."
              />
              <Def
                term="Severity"
                meaning="How urgent the suggested action is: critical, high, medium, or low. It ranks the recommendation. It is not the same switch as Critical on a protocol checkpoint, though both use the word for “this one matters more”."
              />
              <Def
                term="Active"
                meaning="An active note can be offered with a finding. An inactive note stays on file and is withheld from live suggestions. Anyone who can open the knowledge base can add or edit a note with New entry. The screen does not keep a version history of those edits. Treat changes as live once you save them, and agree edits inside the technical team before you change a note other people rely on."
              />
            </dl>
          </Section>

          <Section id="vv" title="V&V projects">
            <p>
              A V&V project in this menu is an internal document pack: a bundle
              of files scored against checkpoints before you rely on them. It
              is created per MinRV project, with New pack, after you have
              selected that project. Inside a pack you add documents one by
              one and run the checkpoints against that set. It is both: the
              pack belongs to one project, and the evidence inside it is
              document by document.
            </p>
            <p>
              This is an internal pre-check for technical staff. The external
              validation and verification body is appointed in Certify or by
              Puro, works in that registry’s process, and does not receive a
              MinRV login to this screen. A pack that passes here is a
              recommendation that the documents are present. It is not the
              registry’s validation report, and it does not issue a credit.
            </p>
            <p>
              There is no delete on this screen. A pack created in error stays
              in the list. Create one only when you intend to keep it. If one
              was created by mistake, leave it unused and tell the operator
              which name to ignore. Do not upload a second copy of the same
              documents into a new pack to “replace” it.
            </p>
          </Section>

          <Section id="ledger" title="Ledger">
            <p>
              The ledger reads credit inventory from Isometric. Use it after
              issuance, when the question is where the tonnes sit.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li><strong className="font-medium text-frost">Overview</strong> — what the connection can see.</li>
              <li><strong className="font-medium text-frost">Batches</strong> — issued batches.</li>
              <li><strong className="font-medium text-frost">Deliver, Transfer, Retire, Buy</strong> — movements. They appear when your role is allowed to write. Buying also requires the buy capability on the connection.</li>
              <li><strong className="font-medium text-frost">Activity</strong> — the record of those movements.</li>
            </ul>
            <p>
              The registry menu on the ledger offers Isometric. All registries
              shows overview only. Puro and Verra are listed and disabled.
              Retirement of a Puro CORC is not available here.
            </p>
          </Section>

          <Section id="walkthrough" title="BioCCS and DAC, end to end">
            <p>
              Use this as the order of work for a new removal project. Skip a
              step only when Certify already shows it done.
            </p>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Confirm the supplier agreement and who holds the Certify login. If that is not you, ask the operator to create the project in the connected organisation.</li>
              <li>In Certify, create the project on DAC or BiCRS, and add the storage module the site uses.</li>
              <li>Add the storage site.</li>
              <li>On the MinRV map, set the registry menu to Isometric and open the project from dMRV Atlas.</li>
              <li>Read the charter. Open setup. File design evidence on each row. Stop at pre-screen until the design is complete.</li>
              <li>In Certify, finish the LCA and project emissions, clear the data checks, and convert operations into a GHG entry template. Request validation there when every design row is ready. The verifier’s visit is Certify’s process.</li>
              <li>Operate the plant. Keep monitoring files and the period’s measured inputs as they happen.</li>
              <li>In MinRV, select the reporting window. File each due monitoring requirement from GHG statements. File the GHG entry from GHG entry data. Create the GHG statement.</li>
              <li>Hand the statement to verification in Certify. Issued tonnes then show on the project row and on the ledger.</li>
              <li>Use Quality only to seed CO₂ rules, inspect a failed check, or score a document pack. Use the ledger only once there are credits to deliver, transfer, or retire.</li>
            </ol>
          </Section>

          <Section id="limits" title="What this workspace cannot do yet">
            <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-mist">
              <li>Create an Isometric project from inside MinRV. Creation stays in Certify.</li>
              <li>Give you a personal sandbox password. The connection is organisational.</li>
              <li>Register a Puro facility, file a Puro output report, or retire a CORC.</li>
              <li>Show Isometric and Puro on one map. The menu filters to one registry.</li>
              <li>Show retired tonnes on the globe tiles. Retirement is on the ledger.</li>
              <li>Delete a V&V pack, or version a knowledge-base edit.</li>
              <li>Hide biochar, cookstove, and avoided-deforestation libraries from Protocol Manager and the knowledge base. Leave them unselected. The operating pathways in this guide are BioCCS (BiCRS), DAC, and the storage module on the project.</li>
              <li>Run Remi, the public comment, or Request validation. Those remain in Certify.</li>
              <li>Act as the external auditor’s system of record.</li>
            </ul>
          </Section>

          <Section id="words" title="Words">
            <dl className="space-y-4">
              <Def term="Reporting window / monitoring period" meaning="The stretch of operations covered by one GHG statement. This is what “periods” and “periods in flight” count." />
              <Def term="Crediting period" meaning="The multi-year span the registry allows the project to be issued against. It contains many reporting windows. The portfolio count is not this number." />
              <Def term="Charter" meaning="The design record already held in Certify: site, project design, LCA, validation, safeguards." />
              <Def term="GHG entry" meaning="One calculation of net removal, using the LCA template, for a start and end date." />
              <Def term="GHG statement" meaning="The folder for one reporting window: the entries in that window plus the monitoring pack." />
              <Def term="Protocol" meaning="On Isometric, the capture rules (DAC or BiCRS). Chosen in Certify at creation." />
              <Def term="Module" meaning="On Isometric, an extra rulebook on the same project, such as in-situ mineralisation for storage. Also chosen in Certify. It is not a Protocol Manager row." />
              <Def term="Checkpoint" meaning="One document question inside a Quality protocol library." />
              <Def term="Critical" meaning="On a checkpoint: failing it fails the document pack." />
              <Def term="V&V pack" meaning="An internal bundle of documents scored in Quality. The external verifier still works in the registry." />
              <Def term="Sandbox" meaning="Isometric’s practice Certify. Keys are on the server. A reviewer uses MinRV. A person creating the project uses Certify." />
              <Def term="LIVE / BUNDLED" meaning="LIVE: the requirement list was read from Certify. BUNDLED: MinRV is showing its packaged copy of the rules." />
            </dl>
          </Section>
        </article>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-mist">{children}</div>
    </section>
  );
}

function Row({ q, href }: { q: string; href: string }) {
  const label = CONTENTS.find((item) => `#${item.id}` === href)?.label ?? "Section";
  return (
    <tr>
      <td className="px-4 py-3 text-frost">{q}</td>
      <td className="px-4 py-3">
        <a href={href} className="font-medium text-carbon-400 hover:underline">
          {label}
        </a>
      </td>
    </tr>
  );
}

function Place({
  name,
  href,
  who,
  detail,
}: {
  name: string;
  href: string;
  who: string;
  detail: string;
}) {
  return (
    <li className="rounded-2xl bg-white px-4 py-3 ring-1 ring-line">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={href} className="font-semibold text-frost hover:text-carbon-400">
          {name}
        </Link>
        <span className="text-[12px] text-mist">{who}</span>
      </div>
      <p className="mt-1 text-[14px] leading-relaxed">{detail}</p>
    </li>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-carbon-400/30 bg-carbon-400/10 px-4 py-3 text-[14px] leading-relaxed text-frost">
      {children}
    </div>
  );
}

function Def({ term, meaning }: { term: string; meaning: string }) {
  return (
    <div>
      <dt className="font-medium text-frost">{term}</dt>
      <dd className="mt-1">{meaning}</dd>
    </div>
  );
}
