// Existing DanSMS fixed prices are preserved as the base.
// Add the owner's additional ₦500 markup on top of each existing customer price.
// Amounts are NGN. Do not derive customer prices from live USD catalogue values.
export const DANSMS_WHATSAPP_PRICES_NGN = Object.freeze({
  US:{supplier:4000,markup:2300,customer:6300},
  CA:{supplier:3000,markup:4500,customer:7500},
  GB:{supplier:4000,markup:2500,customer:6500},
  DE:{supplier:13000,markup:4000,customer:17000},
  IT:{supplier:7000,markup:3000,customer:10000},
  DK:{supplier:13000,markup:3200,customer:16200}
});

export const DANSMS_DEFAULT_VERIFICATION_MARKUP_NGN=500;

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
