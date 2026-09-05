// Public privacy policy page — standalone, no Shopify session required.
// Anyone can access this route directly at /privacy (no authenticate.admin()).
import type { CSSProperties } from "react";

export default function PrivacyPolicy() {
  const sectionHeadingStyle: CSSProperties = {
    fontSize: "16px",
    fontWeight: 600,
    color: "#111827",
    marginTop: "32px",
    marginBottom: "8px",
    borderLeft: "3px solid #7c3aed",
    paddingLeft: "12px",
  };

  const paragraphStyle: CSSProperties = {
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#374151",
    margin: "0 0 12px 0",
  };

  const listStyle: CSSProperties = {
    listStyle: "none",
    padding: 0,
    margin: "0 0 12px 16px",
  };

  const listItemStyle: CSSProperties = {
    fontSize: "15px",
    lineHeight: 1.7,
    color: "#374151",
    paddingLeft: "16px",
    position: "relative",
    marginBottom: "6px",
  };

  const bulletStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    color: "#7c3aed",
    fontSize: "15px",
    lineHeight: 1.7,
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body {
              margin: 0;
              background-color: #f6f6f7 !important;
            }
            ul { list-style: none; margin: 0; padding: 0; }
          `,
        }}
      />
      <div
        style={{
          minHeight: "100vh",
          padding: "48px 16px",
          backgroundColor: "#f6f6f7",
          fontFamily: "system-ui, -apple-system, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: "760px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            padding: "48px",
          }}
        >
          {/* Header */}
          <header>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "#1a1a2e",
              }}
            >
              Price Polish
            </div>
            <div
              style={{
                color: "#6b7280",
                fontSize: "14px",
                marginTop: "4px",
              }}
            >
              Privacy Policy
            </div>
            <div
              style={{
                color: "#9ca3af",
                fontSize: "13px",
                marginTop: "4px",
              }}
            >
              Last updated: September 2026
            </div>
            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                marginTop: "24px",
              }}
            />
          </header>

          {/* Section 1 */}
          <h2 style={sectionHeadingStyle}>1. Introduction</h2>
          <p style={paragraphStyle}>
            Price Polish ("the App") is built and maintained by Price Polish
            (contact:{" "}
            <a
              href="mailto:pricepolish.support@gmail.com"
              style={{ color: "#7c3aed" }}
            >
              pricepolish.support@gmail.com
            </a>
            ). This Privacy Policy describes how we collect, use, disclose, and
            safeguard your information when you install and use our Shopify
            application.
          </p>

          {/* Section 2 */}
          <h2 style={sectionHeadingStyle}>2. Information We Collect</h2>
          <p style={paragraphStyle}>
            When you install Price Polish, we collect:
          </p>
          <ul style={listStyle}>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Your Shopify store domain and OAuth access token to operate the
              app on your behalf.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Product and variant pricing data from your store to enable bulk
              price management.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Campaign history and pricing operation records to provide audit
              trails and rollback capability.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              App usage events such as campaign creation, scheduling, and revert
              actions.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Subscription and billing status via Shopify Billing API.
            </li>
          </ul>

          {/* Section 3 */}
          <h2 style={sectionHeadingStyle}>3. How We Use Your Information</h2>
          <p style={paragraphStyle}>We use your information exclusively to:</p>
          <ul style={listStyle}>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Deliver the Price Polish pricing campaign service.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Maintain pricing history for rollback and audit features.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Process your subscription through Shopify Billing API.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Respond to support and data requests.
            </li>
          </ul>
          <p style={paragraphStyle}>
            We do not sell, rent, or share your data with third parties for
            marketing or advertising purposes.
          </p>

          {/* Section 4 */}
          <h2 style={sectionHeadingStyle}>4. Data Storage and Security</h2>
          <p style={paragraphStyle}>
            Your data is stored in a secure PostgreSQL database (Neon, US East
            region). We use encrypted connections (TLS/SSL), strict access
            controls, and follow industry-standard security practices.
          </p>
          <p style={paragraphStyle}>
            Your Shopify access token is stored securely and used only to
            perform actions you explicitly request.
          </p>

          {/* Section 5 */}
          <h2 style={sectionHeadingStyle}>5. Data Retention</h2>
          <p style={paragraphStyle}>
            We retain your pricing and campaign data while your subscription is
            active. On uninstall, your session data is deleted immediately.
            Campaign history is retained for 90 days post-uninstall to support
            reinstallation, then permanently deleted.
          </p>

          {/* Section 6 */}
          <h2 style={sectionHeadingStyle}>6. Third-Party Services</h2>
          <p style={paragraphStyle}>Price Polish uses:</p>
          <ul style={listStyle}>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Shopify API — to read and update your store pricing.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Neon — secure cloud database hosting.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Render — application hosting and deployment.
            </li>
          </ul>
          <p style={paragraphStyle}>
            These providers have their own privacy policies governing data they
            process on our behalf.
          </p>

          {/* Section 7 */}
          <h2 style={sectionHeadingStyle}>7. Your Rights</h2>
          <p style={paragraphStyle}>You have the right to:</p>
          <ul style={listStyle}>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Access the personal data we hold about your store.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Request correction or deletion of your data.
            </li>
            <li style={listItemStyle}>
              <span style={bulletStyle}>•</span>
              Uninstall the app at any time to stop all data access.
            </li>
          </ul>
          <p style={paragraphStyle}>
            To exercise these rights, contact:{" "}
            <a
              href="mailto:pricepolish.support@gmail.com"
              style={{ color: "#7c3aed" }}
            >
              pricepolish.support@gmail.com
            </a>
          </p>

          {/* Section 8 */}
          <h2 style={sectionHeadingStyle}>8. Cookies</h2>
          <p style={paragraphStyle}>
            Price Polish does not set cookies directly. Shopify may use cookies
            as part of the embedded app authentication process, governed by
            Shopify's own Privacy Policy.
          </p>

          {/* Section 9 */}
          <h2 style={sectionHeadingStyle}>9. Children's Privacy</h2>
          <p style={paragraphStyle}>
            Price Polish is a business tool for Shopify merchants. We do not
            knowingly collect data from individuals under 18 years of age.
          </p>

          {/* Section 10 */}
          <h2 style={sectionHeadingStyle}>10. Changes to This Policy</h2>
          <p style={paragraphStyle}>
            We may update this Privacy Policy periodically. Material changes
            will be communicated via the app interface. Continued use after
            changes constitutes acceptance of the updated policy.
          </p>

          {/* Section 11 */}
          <h2 style={sectionHeadingStyle}>11. Contact</h2>
          <p style={paragraphStyle}>
            For privacy questions or data deletion requests:
            <br />
            Email:{" "}
            <a
              href="mailto:pricepolish.support@gmail.com"
              style={{ color: "#7c3aed" }}
            >
              pricepolish.support@gmail.com
            </a>
            <br />
            Response time: within 48 business hours.
          </p>

          {/* Footer */}
          <footer
            style={{
              textAlign: "center",
              color: "#9ca3af",
              fontSize: "13px",
              borderTop: "1px solid #e5e7eb",
              paddingTop: "24px",
              marginTop: "48px",
            }}
          >
            © 2026 Price Polish. All rights reserved.
          </footer>
        </div>
      </div>
    </>
  );
}
