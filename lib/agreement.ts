// The Loop Network Advertising Service Agreement that a host accepts (with a
// typed signature) during venue registration. Stored on the venue row as
// agreement_version so the exact text a host signed is auditable later.
//
// Source: "Loop Network Advertising Agreement Template NC" (North Carolina
// governing law). When the text changes materially, bump AGREEMENT_VERSION so
// prior signatures still point at the version they actually agreed to.

export const AGREEMENT_VERSION = 'nc-2026-07'
export const AGREEMENT_TITLE = 'Loop Network LLC — Advertising Service Agreement'
export const AGREEMENT_GOVERNING_STATE = 'North Carolina'

export const AGREEMENT_INTRO =
  'This Advertising Service Agreement ("Agreement") is entered into by and between ' +
  'Loop Network LLC ("Provider") and the undersigned business ("Advertiser"/"Host").'

export interface AgreementSection {
  n: number
  title: string
  /** Body paragraphs are separated by a blank line ("\n\n"). */
  body: string
}

export const AGREEMENT_SECTIONS: AgreementSection[] = [
  {
    n: 1,
    title: 'Services',
    body: "Provider will display Advertiser's approved advertisements across participating Loop Network host businesses through digital displays and related marketing platforms. Advertisement placement, scheduling, and duration are determined by the selected advertising package.",
  },
  {
    n: 2,
    title: 'Independent Relationship',
    body: 'Advertiser acknowledges it is an independent business. Nothing in this Agreement creates a partnership, agency, franchise, joint venture, employment relationship, or ownership interest between the parties.',
  },
  {
    n: 3,
    title: 'No Endorsement or Affiliation',
    body: 'Advertising through Loop Network does not constitute an endorsement, recommendation, certification, sponsorship, or approval of Advertiser by Loop Network LLC. Advertiser shall not represent that it is owned by, affiliated with, officially endorsed by, or acting on behalf of Loop Network LLC.',
  },
  {
    n: 4,
    title: 'Content Responsibility',
    body: 'Advertiser is solely responsible for the accuracy, legality, and ownership of all advertisements, logos, trademarks, pricing, offers, promotions, and claims submitted. Advertiser grants Provider a non-exclusive license to display submitted content during the Agreement term.',
  },
  {
    n: 5,
    title: 'Advertising Approval',
    body: 'Provider may approve, reject, edit for formatting, suspend, or remove any advertisement that is unlawful, misleading, offensive, defamatory, infringes intellectual property rights, or may negatively affect the integrity or reputation of Loop Network LLC.',
  },
  {
    n: 6,
    title: 'Equipment & Software',
    body: 'All equipment, streaming devices, televisions supplied by Provider, software, applications, accounts, playlists, remote management systems, and related equipment remain the exclusive property of Provider. Host businesses and Advertisers shall not disconnect, modify, relocate, factory reset, install software on, or interfere with Provider equipment without written authorization.',
  },
  {
    n: 7,
    title: 'Technical Issues',
    body: 'Provider does not guarantee uninterrupted advertising services. Temporary outages, software updates, internet failures, power outages, hardware failures, maintenance, or third-party service interruptions shall not constitute a breach of this Agreement.',
  },
  {
    n: 8,
    title: 'Limitation of Liability',
    body: 'Provider shall not be liable for indirect, incidental, special, punitive, consequential, or lost-profit damages. Provider is not responsible for the actions, advertisements, products, services, or representations of other advertisers or participating businesses.',
  },
  {
    n: 9,
    title: 'Indemnification',
    body: "Advertiser agrees to defend, indemnify, and hold harmless Loop Network LLC, its owners, officers, employees, contractors, and affiliates from any claim arising from Advertiser's advertisements, intellectual property, products, services, negligence, or violation of law.",
  },
  {
    n: 10,
    title: 'Payment',
    body: 'Advertising fees are due according to the selected package. Late payments may result in suspension or removal of advertisements. Fees previously earned are non-refundable unless otherwise agreed in writing.',
  },
  {
    n: 11,
    title: 'Term & Termination',
    body: 'Either party may terminate pursuant to the agreed notice period. Provider may immediately suspend or terminate services for non-payment, illegal activity, misleading advertising, misuse of Provider branding or equipment, or conduct damaging to the network.',
  },
  {
    n: 12,
    title: 'Confidentiality',
    body: 'Each party agrees to protect confidential business information obtained through this relationship.',
  },
  {
    n: 13,
    title: 'Governing Law',
    body: 'This Agreement shall be governed by the laws of the State of North Carolina. Any legal action shall be brought in a court of competent jurisdiction located in North Carolina unless otherwise agreed.',
  },
  {
    n: 14,
    title: 'Non-Competition & Non-Circumvention',
    body:
      "During the term of this Agreement and for a period of twelve (12) months following its termination, Advertiser agrees not to knowingly circumvent or interfere with Provider's business relationships by directly soliciting, contracting with, or attempting to establish substantially similar advertising arrangements with businesses introduced through the Loop Network LLC platform for the purpose of avoiding Provider's services or fees." +
      '\n\n' +
      "Advertiser further agrees not to use Provider's confidential business methods, pricing models, proprietary advertising network, software, marketing strategies, customer lists, or other confidential information to create, operate, assist, or promote a competing in-venue digital advertising network that is substantially similar to the Loop Network LLC platform." +
      '\n\n' +
      "Nothing in this section shall prohibit Advertiser from engaging in general advertising, conducting its normal business operations, or purchasing advertising services from unrelated third parties that are not based upon Provider's confidential information or business relationships." +
      '\n\n' +
      'If Advertiser breaches this provision, Provider shall be entitled to seek injunctive relief, monetary damages, reasonable attorneys’ fees, court costs, and any other remedies available under applicable law.',
  },
]
