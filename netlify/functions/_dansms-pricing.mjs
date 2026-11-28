// Prices explicitly supplied by the All Ads Manager owner.
// Amounts are NGN. Do not derive customer prices from live USD catalogue values.
export const DANSMS_WHATSAPP_PRICES_NGN = Object.freeze({
  US:{supplier:4000,markup:1800,customer:5800},
  CA:{supplier:3000,markup:4000,customer:7000},
  GB:{supplier:4000,markup:2000,customer:6000},
  DE:{supplier:13000,markup:3500,customer:16500},
  IT:{supplier:7000,markup:2500,customer:9500},
  DK:{supplier:13000,markup:2700,customer:15700}
});

export const DANSMS_DEFAULT_VERIFICATION_MARKUP_NGN=1500;

// DanSMS account prices recovered from the owner's earlier instructions.
// Apply the newly requested additional ₦500 to each product markup.
export const DANSMS_ACCOUNT_PRICE_RULES_NGN = Object.freeze({
  '711 account / 200 IPs': { supplier: 35000, markup: 3500, customer: 38500 },
  'Twitter account': { supplier: 7000, markup: 3000, customer: 10000 }
});

// Numeric IDs from the owner's earlier DanSMS dashboard/API details.
// Keep these for the legacy handler only; v1 uses ISO alpha-2 country codes.
export const DANSMS_LEGACY_COUNTRY_IDS=Object.freeze({US:187,IN:22});

export function dansmsWhatsAppPrice(countryCode){
  const code=String(countryCode||'').trim().toUpperCase();
  const exact=DANSMS_WHATSAPP_PRICES_NGN[code];
  if(exact)return {...exact,currency:'NGN'};
  return {supplier:null,markup:DANSMS_DEFAULT_VERIFICATION_MARKUP_NGN,customer:null,currency:'NGN',requiresLiveSupplierPrice:true};
}
