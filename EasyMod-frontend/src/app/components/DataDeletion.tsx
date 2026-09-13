import { Link } from "react-router-dom";
import Seo from "./Seo";

const CONTACT_EMAIL = "privacy@easymod.tech";

export default function DataDeletion() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Seo
        title="EasyModerator Data Deletion"
        description="How to request deletion of EasyModerator account and Facebook Messenger data."
        canonicalPath="/data-deletion"
      />
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600" />
            <span className="text-lg font-bold text-gray-900">EasyModerator</span>
          </Link>
          <span className="text-sm text-gray-500">Data Deletion</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900">Data Deletion Request</h1>
        <p className="mt-3 text-gray-600 leading-relaxed">
          You can request deletion of EasyModerator account, shop, and Facebook Messenger data at any time.
        </p>
        <ol className="mt-6 list-decimal list-inside space-y-3 text-gray-700 leading-relaxed">
          <li>Email <a className="text-blue-600 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with subject <strong>Facebook Data Deletion Request</strong>.</li>
          <li>Include the Facebook account or Page details needed to identify the connection. Do not include passwords or access tokens.</li>
          <li>We will process the request within 30 days and reply with confirmation or any legally required retention explanation.</li>
        </ol>
        <section className="mt-8 rounded-xl border border-blue-100 bg-blue-50 p-5 text-blue-900">
          <h2 className="font-semibold">Facebook app removal</h2>
          <p className="mt-2 leading-relaxed">
            You may also remove EasyModerator from Facebook Settings &gt; Apps and Websites. If Meta sends a valid
            deletion callback, EasyModerator processes the request and provides a confirmation status URL.
          </p>
        </section>
        <p className="mt-8 text-sm text-gray-600">
          See the <Link className="text-blue-600 hover:underline" to="/privacy-policy">Privacy Policy</Link> for retention details.
        </p>
      </main>
    </div>
  );
}
