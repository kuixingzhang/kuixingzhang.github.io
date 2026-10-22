import SiteHeader from "@/components/SiteHeader";
const features = [
  {
    label: "1. Practice",
    title: "Professional Practice",
    description:
      "View the current professional schedule and access archived schedule records.",
    href: "/professional-practice/schedule",
  },
  {
    label: "2. Education",
    title: "Teaching & Education",
    description:
      "Pathology education focused on diagnostic reasoning, pattern recognition, and practical experience.",
    href: "/teaching",
  },
  {
    label: "3. Contact",
    title: "Professional Contact",
    description:
      "Download my professional contact information and add it directly to your contacts.",
    href: "/business-card.vcf",
  },
  {
    label: "4. Documents",
    title: "Document Management",
    description:
      "A private library for important professional documents, organized for convenient retrieval and submission.",
    href: "/documents",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="site-container">
            <p className="eyebrow">Anatomic & Clinical Pathology</p>

            <h1>
              Diagnostic Excellence.
              <br />
              Clinical Insight.
            </h1>
          </div>
        </section>

        <section className="section">
          <div className="site-container">
            <h2 className="section-heading">Professional Resources</h2>

            <p className="section-description">
              Practical tools and resources supporting professional practice,
              education, and continuous improvement in pathology.
            </p>

            <div className="feature-grid">
              {features.map((feature) => (
                <a
                  className="feature-card"
                  href={feature.href}
                  key={feature.label}
                >
                  <p className="card-label">{feature.label}</p>

                  <h3>{feature.title}</h3>

                  <p>{feature.description}</p>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="site-container footer-inner">
          <p className="footer-copy">
            © 2026 Kuixing Zhang, MD, PhD.
            <br />
            Dr. Zhang Pathology · Diagnostic Excellence
          </p>
        </div>
      </footer>
    </>
  );
}
