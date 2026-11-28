// Prices explicitly supplied by the All Ads Manager owner.
// Amounts are NGN. Do not derive customer prices from live USD catalogue values.
export const DANSMS_WHATSAPP_PRICES_NGN = Object.freeze({
  US:{supplier:4000,markup:1300,customer:5300},
  CA:{supplier:3000,markup:3500,customer:6500},
  GB:{supplier:4000,markup:1500,customer:5500},
  DE:{supplier:13000,markup:3000,customer:16000},
  IT:{supplier:7000,markup:2000,customer:9000},
  DK:{supplier:13000,markup:2200,customer:15200}
});

export const DANSMS_DEFAULT_VERIFICATION_MARKUP_NGN=1000;

// Numeric IDs from the owner's earlier DanSMS dashboard/API details.
// Keep these for the legacy handler only; v1 uses ISO alpha-2 country codes.
export const DANSMS_LEGACY_COUNTRY_IDS=Object.freeze({US:187,IN:22});

export function dansmsWhatsAppPrice(countryCode){
  const code=String(countryCode||'').trim().toUpperCase();
  const exact=DANSMS_WHATSAPP_PRICES_NGN[code];
  if(exact)return {...exact,currency:'NGN'};
  return {supplier:null,markup:DANSMS_DEFAULT_VERIFICATION_MARKUP_NGN,customer:null,currency:'NGN',requiresLiveSupplierPrice:true};
}
