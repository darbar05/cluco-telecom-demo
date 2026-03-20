"""
Mock telecom knowledge base with billing, product, and support documents.
Each document has: id, category, subcategory, title, content.
"""

TELECOM_DOCUMENTS = [
    # ─── BILLING DOCUMENTS ───────────────────────────────────────────────
    {
        "id": "billing-001",
        "category": "billing",
        "subcategory": "plans",
        "title": "Basic Plan Overview",
        "content": (
            "The Basic Plan costs $29.99/month and includes 5GB of high-speed data, "
            "unlimited talk and text within the US, and access to our standard 4G LTE network. "
            "After 5GB, data speeds are reduced to 2G (128kbps). "
            "No mobile hotspot is included. International calling is available as an add-on for $10/month. "
            "This plan does not include any device subsidies or installment credits."
        ),
    },
    {
        "id": "billing-002",
        "category": "billing",
        "subcategory": "plans",
        "title": "Premium Plan Overview",
        "content": (
            "The Premium Plan costs $49.99/month and includes 25GB of high-speed data, "
            "unlimited talk and text, 10GB mobile hotspot, and access to our 5G network where available. "
            "After 25GB, speeds may be temporarily reduced during network congestion. "
            "Includes free international texting to 120+ countries. "
            "Eligible for device installment plans with $0 down on select devices."
        ),
    },
    {
        "id": "billing-003",
        "category": "billing",
        "subcategory": "plans",
        "title": "Ultimate Plan Overview",
        "content": (
            "The Ultimate Plan costs $79.99/month and includes truly unlimited high-speed data "
            "with no throttling, 50GB mobile hotspot, premium 5G access, and HD video streaming. "
            "Includes free international calling to 85+ countries and international texting to 200+ countries. "
            "Eligible for all device promotions including buy-one-get-one offers and maximum trade-in values. "
            "Also includes a free subscription to StreamMax entertainment bundle worth $15/month."
        ),
    },
    {
        "id": "billing-004",
        "category": "billing",
        "subcategory": "billing_cycle",
        "title": "Billing Cycle and Due Dates",
        "content": (
            "Your billing cycle runs from the 1st to the last day of each month. "
            "Bills are generated on the 1st and payment is due by the 15th. "
            "You can view your bill online, in the app, or request a paper statement for $2/month. "
            "If you sign up mid-cycle, your first bill will be prorated based on the remaining days. "
            "Billing cycle dates cannot be changed once established."
        ),
    },
    {
        "id": "billing-005",
        "category": "billing",
        "subcategory": "payment_methods",
        "title": "Payment Methods",
        "content": (
            "We accept Visa, Mastercard, American Express, Discover, debit cards, and bank transfers (ACH). "
            "You can set up AutoPay through your online account or the mobile app. "
            "AutoPay customers receive a $5/month discount on any plan. "
            "One-time payments can be made online, by phone (dial 611), or at any retail store. "
            "Payment by mail is accepted with a check or money order sent to our billing center."
        ),
    },
    {
        "id": "billing-006",
        "category": "billing",
        "subcategory": "late_fees",
        "title": "Late Payment Policy",
        "content": (
            "If payment is not received by the due date, a late fee of $5 will be applied after a 5-day grace period. "
            "After 30 days past due, service may be temporarily suspended. "
            "After 60 days past due, service will be disconnected and the account sent to collections. "
            "To restore a suspended account, all past-due amounts plus a $25 reconnection fee must be paid. "
            "Payment arrangements can be set up by calling customer service at 1-800-555-TELCO."
        ),
    },
    {
        "id": "billing-007",
        "category": "billing",
        "subcategory": "discounts",
        "title": "Available Discounts and Promotions",
        "content": (
            "AutoPay discount: $5/month off any plan when enrolled in automatic payments. "
            "Multi-line discount: Add a 2nd line for $20/month less, 3rd line for $30/month less. "
            "Military/Veteran discount: 15% off monthly plan cost with valid military ID. "
            "Senior discount (65+): 10% off monthly plan cost. "
            "Student discount: $10/month off Premium or Ultimate plans with valid .edu email. "
            "Employee referral: Both parties get $50 bill credit when a new line is activated."
        ),
    },
    {
        "id": "billing-008",
        "category": "billing",
        "subcategory": "promo_codes",
        "title": "Current Promotional Offers",
        "content": (
            "SPRING2026: Get 3 months free on the Ultimate Plan for new customers. Valid through April 30, 2026. "
            "SWITCH50: Receive a $50 bill credit when switching from another carrier. Must port existing number. "
            "FAMILYPLUS: Add up to 4 lines and pay only $25/line/month on the Premium Plan. "
            "FREEMONTH: Existing customers get 1 month free when upgrading from Basic to Premium or Ultimate. "
            "Promo codes are entered at checkout or by calling customer service. Only one promo per account."
        ),
    },
    {
        "id": "billing-009",
        "category": "billing",
        "subcategory": "autopay",
        "title": "AutoPay Setup and Management",
        "content": (
            "AutoPay automatically deducts your monthly bill from your preferred payment method on the due date. "
            "To enroll, go to Account Settings > Payment > AutoPay in the app or online portal. "
            "AutoPay can be cancelled at any time without penalty, but you will lose the $5/month discount. "
            "If an AutoPay payment fails, you will be notified by email and text, and have 3 days to make a manual payment. "
            "AutoPay processes payments at 6:00 AM ET on your due date."
        ),
    },
    {
        "id": "billing-010",
        "category": "billing",
        "subcategory": "family_plans",
        "title": "Family Plan Details",
        "content": (
            "Family plans allow 2-5 lines on a single account with shared billing. "
            "The primary account holder manages all lines and is responsible for payment. "
            "Each line can have a different plan tier (Basic, Premium, or Ultimate). "
            "Family plan multi-line discounts: 2nd line -$20, 3rd line -$30, 4th line -$35, 5th line -$40. "
            "A family plan can mix and match adult and child lines. Child lines include built-in parental controls."
        ),
    },
    {
        "id": "billing-011",
        "category": "billing",
        "subcategory": "taxes_fees",
        "title": "Taxes and Regulatory Fees",
        "content": (
            "All plan prices listed are before taxes and regulatory fees. "
            "Typical taxes and fees add 8-15% depending on your state and local jurisdiction. "
            "Federal Universal Service Fund fee: $1.50/line/month. "
            "Regulatory cost recovery fee: $3.30/line/month. "
            "911 fee: Varies by state, typically $0.50-$2.00/line/month. "
            "One-time activation fee for new lines: $30 (waived for online orders)."
        ),
    },

    # ─── PRODUCT DOCUMENTS ───────────────────────────────────────────────
    {
        "id": "product-001",
        "category": "products",
        "subcategory": "devices",
        "title": "iPhone 16 Pro",
        "content": (
            "iPhone 16 Pro: Starting at $999 (128GB), $1,099 (256GB), $1,299 (512GB), $1,499 (1TB). "
            "Features: 6.3-inch Super Retina XDR OLED display, A18 Pro chip, 48MP triple camera system, "
            "USB-C with Thunderbolt, titanium frame, up to 29 hours video playback. "
            "Colors: Natural Titanium, Blue Titanium, White Titanium, Black Titanium. "
            "Trade-in value for iPhone 15 Pro: up to $550. Trade-in for iPhone 14 Pro: up to $400. "
            "Available on 24-month installment plan: from $41.63/month with $0 down on Premium/Ultimate plans."
        ),
    },
    {
        "id": "product-002",
        "category": "products",
        "subcategory": "devices",
        "title": "Samsung Galaxy S25 Ultra",
        "content": (
            "Samsung Galaxy S25 Ultra: Starting at $1,199 (256GB), $1,299 (512GB), $1,419 (1TB). "
            "Features: 6.9-inch Dynamic AMOLED 2X display, Snapdragon 8 Elite, 200MP quad camera, "
            "S Pen included, titanium frame, 5000mAh battery with 45W fast charging. "
            "Colors: Titanium Silverblue, Titanium Gray, Titanium Black, Titanium Whitesilver. "
            "Trade-in value for Galaxy S24 Ultra: up to $500. Trade-in for Galaxy S23 Ultra: up to $350. "
            "Available on 36-month installment plan: from $33.31/month with $0 down on Premium/Ultimate plans."
        ),
    },
    {
        "id": "product-003",
        "category": "products",
        "subcategory": "devices",
        "title": "Google Pixel 9 Pro",
        "content": (
            "Google Pixel 9 Pro: Starting at $899 (128GB), $999 (256GB), $1,099 (512GB). "
            "Features: 6.3-inch Super Actua LTPO OLED display, Tensor G4 chip, 50MP triple camera "
            "with AI-powered photography, 7 years of OS and security updates. "
            "Colors: Obsidian, Porcelain, Hazel, Rose Quartz. "
            "Trade-in value for Pixel 8 Pro: up to $400. Trade-in for Pixel 7 Pro: up to $250. "
            "Available on 24-month installment plan: from $37.46/month with $0 down on Premium/Ultimate plans."
        ),
    },
    {
        "id": "product-004",
        "category": "products",
        "subcategory": "devices",
        "title": "Budget-Friendly Devices",
        "content": (
            "Samsung Galaxy A15: $199, 6.5-inch display, 50MP camera, 5000mAh battery, 128GB storage. "
            "iPhone SE (4th gen): $429, 6.1-inch OLED display, A18 chip, 48MP camera, USB-C. "
            "Google Pixel 8a: $499, 6.1-inch OLED display, Tensor G3, 64MP camera, 7 years updates. "
            "Motorola Moto G Power: $249, 6.7-inch display, 50MP camera, 5000mAh, 256GB storage. "
            "All budget devices available on 24-month installment with $0 down on any plan."
        ),
    },
    {
        "id": "product-005",
        "category": "products",
        "subcategory": "accessories",
        "title": "Phone Accessories",
        "content": (
            "Cases: OtterBox Defender ($59.99), Apple Silicone Case ($49.99), Samsung Clear Case ($29.99). "
            "Screen protectors: Tempered glass ($19.99), Privacy screen ($29.99). "
            "Chargers: 20W USB-C adapter ($19.99), 35W dual USB-C ($39.99), wireless charging pad ($29.99). "
            "MagSafe charger ($39.99), 15W wireless car mount ($49.99). "
            "Earbuds: AirPods Pro 2 ($249), Galaxy Buds3 Pro ($229), Pixel Buds Pro 2 ($199). "
            "All accessories can be added to your device installment plan."
        ),
    },
    {
        "id": "product-006",
        "category": "products",
        "subcategory": "trade_in",
        "title": "Device Trade-In Program",
        "content": (
            "Trade in your current device and receive credit toward a new purchase. "
            "Trade-in values: iPhone 15 Pro Max up to $630, iPhone 15 Pro up to $550, iPhone 15 up to $400. "
            "Galaxy S24 Ultra up to $500, Galaxy S24+ up to $380, Galaxy S24 up to $300. "
            "Pixel 8 Pro up to $400, Pixel 8 up to $280. "
            "Devices must power on, have no cracks, and pass a functional check. "
            "Trade-in credit is applied as monthly bill credits over 24 months or as instant credit at retail stores. "
            "Mail-in trade-in kits available; you have 30 days to send in the old device after receiving the new one."
        ),
    },
    {
        "id": "product-007",
        "category": "products",
        "subcategory": "upgrade_eligibility",
        "title": "Device Upgrade Eligibility",
        "content": (
            "You are eligible for a device upgrade once you have paid off at least 50% of your current device installment plan. "
            "Early upgrade option: Pay off remaining balance and upgrade immediately. "
            "Annual upgrade program (Ultimate Plan only): Upgrade every 12 months by returning your current device in good condition. "
            "Upgrade eligibility can be checked in the app under Account > Devices > Upgrade Status. "
            "When upgrading, your old device installment ends and a new one begins. "
            "You can also upgrade by purchasing a device at full retail price at any time regardless of eligibility."
        ),
    },
    {
        "id": "product-008",
        "category": "products",
        "subcategory": "protection_plans",
        "title": "Device Protection Plans",
        "content": (
            "TelcoShield Basic ($9/month): Covers mechanical breakdowns after manufacturer warranty. "
            "Deductible: $99 for phones under $800, $149 for phones $800+. "
            "TelcoShield Plus ($15/month): Covers mechanical breakdowns, accidental damage (drops, spills, cracked screen). "
            "Deductible: $49 for screen repair, $99/$149 for full replacement. Includes same-day screen repair at select locations. "
            "TelcoShield Complete ($19/month): Everything in Plus, plus theft and loss coverage. "
            "Deductible: $49 screen, $99/$149 damage, $199 theft/loss. Includes unlimited screen repairs per year. "
            "All plans include 24/7 tech support and next-business-day device replacement."
        ),
    },
    {
        "id": "product-009",
        "category": "products",
        "subcategory": "device_comparison",
        "title": "Flagship Device Comparison 2026",
        "content": (
            "iPhone 16 Pro vs Galaxy S25 Ultra vs Pixel 9 Pro comparison: "
            "Display: 6.3in vs 6.9in vs 6.3in. Best display size: Galaxy S25 Ultra. "
            "Camera: 48MP triple vs 200MP quad vs 50MP triple. Best camera resolution: Galaxy S25 Ultra. Best AI photo: Pixel 9 Pro. "
            "Battery: 29hr video vs 30hr video vs 24hr video. Best battery: Galaxy S25 Ultra. "
            "Price: from $999 vs from $1,199 vs from $899. Best value: Pixel 9 Pro. "
            "Best for Apple ecosystem: iPhone 16 Pro. Best for Android power users: Galaxy S25 Ultra. "
            "Best for photography and AI features: Pixel 9 Pro. Best for S Pen productivity: Galaxy S25 Ultra."
        ),
    },
    {
        "id": "product-010",
        "category": "products",
        "subcategory": "smartwatch",
        "title": "Smartwatches and Wearables",
        "content": (
            "Apple Watch Series 10: $399 (GPS), $499 (GPS+Cellular). Requires iPhone. "
            "Samsung Galaxy Watch 7: $299 (Bluetooth), $349 (LTE). Works with any Android phone. "
            "Google Pixel Watch 3: $349 (WiFi), $449 (LTE). Best with Pixel phones. "
            "Adding a smartwatch line costs $10/month for cellular connectivity. "
            "Smartwatch lines share your phone's plan data. "
            "NumberSync allows your watch to use the same phone number as your primary device."
        ),
    },

    # ─── SUPPORT DOCUMENTS ───────────────────────────────────────────────
    {
        "id": "support-001",
        "category": "support",
        "subcategory": "network_troubleshooting",
        "title": "Network Connectivity Issues",
        "content": (
            "If you are experiencing poor signal or no service: "
            "1. Toggle Airplane Mode on and off. "
            "2. Restart your device. "
            "3. Check for carrier settings updates (Settings > General > About on iPhone, Settings > Software Update on Android). "
            "4. Remove and reinsert your SIM card. "
            "5. Reset network settings (this will erase saved WiFi passwords). "
            "6. Check our coverage map at coverage.telco.com for your area. "
            "If issues persist, contact technical support at 1-800-555-TECH or visit a retail store for a free diagnostic."
        ),
    },
    {
        "id": "support-002",
        "category": "support",
        "subcategory": "sim_activation",
        "title": "SIM Card Activation",
        "content": (
            "To activate a new SIM card: "
            "1. Insert the SIM into your device. "
            "2. Power on the device. "
            "3. Visit activate.telco.com or call 1-800-555-ACTV. "
            "4. Enter the SIM card number (ICCID, 19-20 digits on the SIM card). "
            "5. Enter your account PIN or last 4 of SSN for verification. "
            "6. Activation typically completes within 5 minutes but can take up to 2 hours. "
            "If porting a number from another carrier, the process may take 4-24 hours. "
            "eSIM activation: Go to Settings > Cellular > Add eSIM, scan the QR code from your welcome email."
        ),
    },
    {
        "id": "support-003",
        "category": "support",
        "subcategory": "international_roaming",
        "title": "International Roaming",
        "content": (
            "International roaming rates without a roaming package: "
            "Calls: $2.00/minute, Texts: $0.50/text, Data: $10/100MB. "
            "Global Roaming Pass ($10/day): Use your domestic plan allowances in 120+ countries. "
            "Data is capped at 2GB/day for high-speed, then reduced to 256kbps. "
            "Ultimate Plan includes the Global Roaming Pass at no extra cost in 85 countries. "
            "To enable roaming: Settings > Cellular > Data Roaming > On. "
            "To avoid surprise charges, enable Travel Mode in our app before departing. "
            "Wi-Fi calling is free and works internationally (uses your domestic minutes)."
        ),
    },
    {
        "id": "support-004",
        "category": "support",
        "subcategory": "voicemail",
        "title": "Voicemail Setup and Features",
        "content": (
            "To set up voicemail: Dial *86 from your device and follow the prompts. "
            "Create a 4-7 digit PIN and record your greeting. "
            "Visual Voicemail is available on all smartphones at no extra charge. "
            "Visual Voicemail lets you see a list of messages, play them in any order, and read transcriptions. "
            "Voicemail storage: up to 40 messages, kept for 30 days (listened) or 14 days (unheard). "
            "To access voicemail from another phone: Call your number, press * during greeting, enter PIN. "
            "Voicemail-to-text transcription is included free on Premium and Ultimate plans."
        ),
    },
    {
        "id": "support-005",
        "category": "support",
        "subcategory": "account_security",
        "title": "Account Security and Fraud Prevention",
        "content": (
            "To protect your account: "
            "1. Set a unique account PIN (4-8 digits) in Account Settings > Security. "
            "2. Enable two-factor authentication (2FA) via SMS or authenticator app. "
            "3. Set up a SIM lock to prevent unauthorized SIM swaps. "
            "4. Monitor your account for unauthorized changes via email/text alerts. "
            "If you suspect fraud or unauthorized access: "
            "1. Call our fraud hotline immediately: 1-800-555-FRAUD (24/7). "
            "2. We will freeze your account within minutes. "
            "3. File a police report if identity theft is suspected. "
            "We will never ask for your full SSN, account PIN, or password via phone, email, or text."
        ),
    },
    {
        "id": "support-006",
        "category": "support",
        "subcategory": "coverage",
        "title": "Network Coverage Information",
        "content": (
            "Our network covers 99% of the US population with 4G LTE. "
            "5G coverage is available in 300+ cities and expanding monthly. "
            "5G Ultra Wideband (mmWave) is available in select downtown areas of 50 major cities. "
            "Check detailed coverage at coverage.telco.com - enter your address or ZIP code. "
            "Coverage types: 5G Ultra Wideband (fastest), 5G Nationwide, Extended 4G LTE, 4G LTE. "
            "Indoor coverage may differ from outdoor coverage. "
            "If you have consistent coverage issues at your home, you can request a free Network Extender device "
            "that uses your home internet to boost cellular signal."
        ),
    },
    {
        "id": "support-007",
        "category": "support",
        "subcategory": "esim",
        "title": "eSIM Information and Setup",
        "content": (
            "eSIM is a digital SIM that allows you to activate a cellular plan without a physical SIM card. "
            "Supported devices: iPhone 14 and later, Pixel 6 and later, Galaxy S21 and later. "
            "Benefits: No physical SIM to lose, switch plans instantly, use dual SIM (physical + eSIM). "
            "To set up eSIM: Go to Settings > Cellular > Add eSIM. "
            "Option 1: Scan the QR code sent to your email after purchase. "
            "Option 2: Use Carrier Activation - select our carrier from the list. "
            "eSIM can be transferred to a new device by removing it from the old device first. "
            "Up to 5 eSIM profiles can be stored on supported devices (only one active at a time alongside a physical SIM)."
        ),
    },
    {
        "id": "support-008",
        "category": "support",
        "subcategory": "5g_faq",
        "title": "5G Network FAQ",
        "content": (
            "Q: Do I need a new phone for 5G? A: Yes, you need a 5G-capable device. All phones released in 2023+ support 5G. "
            "Q: Is 5G available in my area? A: Check coverage.telco.com. 5G Nationwide covers 300+ cities. "
            "Q: Which plans include 5G? A: Premium and Ultimate plans include 5G access. Basic plan is 4G LTE only. "
            "Q: Is 5G faster than 4G? A: 5G Nationwide is 2-5x faster than 4G. 5G Ultra Wideband can be 10-25x faster. "
            "Q: Does 5G use more battery? A: Slightly, but modern devices are optimized for 5G efficiency. "
            "Q: Can I turn off 5G? A: Yes, go to Settings > Cellular > Voice & Data > LTE to use 4G only."
        ),
    },
    {
        "id": "support-009",
        "category": "support",
        "subcategory": "returns",
        "title": "Device Returns and Exchanges",
        "content": (
            "Return policy: You have 30 days from purchase to return or exchange a device. "
            "The device must be in like-new condition with original packaging and accessories. "
            "A $45 restocking fee applies to all device returns (waived for defective devices). "
            "Refunds are processed to the original payment method within 5-7 business days. "
            "Online orders: Request a return shipping label from your order history page. "
            "In-store purchases: Return to any retail location with your receipt. "
            "Installment plan devices: Remaining balance is cancelled upon return. "
            "Accessories have a 14-day return window with no restocking fee."
        ),
    },
    {
        "id": "support-010",
        "category": "support",
        "subcategory": "data_transfer",
        "title": "Transferring Data to a New Device",
        "content": (
            "iPhone to iPhone: Use Quick Start - hold new iPhone near old iPhone and follow prompts. "
            "Android to Android: Use Google's built-in transfer tool during new device setup. "
            "iPhone to Android: Download 'Switch to Android' app on your iPhone before starting. "
            "Android to iPhone: Download 'Move to iOS' app on your Android device. "
            "What transfers: Contacts, photos, videos, messages, apps, calendar, email accounts. "
            "What may not transfer: Some app data, DRM-protected content, certain settings. "
            "Tip: Back up your old device to iCloud/Google before starting. "
            "In-store transfer assistance is free with any device purchase."
        ),
    },
    {
        "id": "support-011",
        "category": "support",
        "subcategory": "wifi_calling",
        "title": "Wi-Fi Calling Setup",
        "content": (
            "Wi-Fi Calling lets you make and receive calls and texts over a Wi-Fi connection. "
            "Useful in areas with poor cellular coverage but good Wi-Fi. "
            "iPhone: Settings > Phone > Wi-Fi Calling > Enable. "
            "Android: Settings > Connections > Wi-Fi Calling > Enable. "
            "Wi-Fi calls use your plan's regular minutes (or are unlimited on all current plans). "
            "911 calls over Wi-Fi: You must register a physical address for emergency services. "
            "Wi-Fi Calling works internationally - calls route as domestic calls (no roaming charges). "
            "Requires a minimum Wi-Fi speed of 1 Mbps for voice calls, 2 Mbps for video calls."
        ),
    },
    {
        "id": "support-012",
        "category": "support",
        "subcategory": "parental_controls",
        "title": "Parental Controls and Family Safety",
        "content": (
            "TelcoFamily app: Free for all customers with family plans. "
            "Features: Set screen time limits, block specific apps, filter web content, "
            "set location alerts (geofencing), pause internet access, view usage reports. "
            "Content filters: Age-based presets (Child 0-7, Tween 8-12, Teen 13-17) or custom. "
            "Location sharing: See your family members' locations in real-time on a map. "
            "Driving mode: Automatically silences notifications when driving is detected. "
            "Usage alerts: Get notified when a child line exceeds set data or purchase limits. "
            "To set up: Download TelcoFamily app, sign in with primary account holder credentials."
        ),
    },
]


def get_documents_by_category(category: str) -> list[dict]:
    return [doc for doc in TELECOM_DOCUMENTS if doc["category"] == category]


def get_all_documents() -> list[dict]:
    return TELECOM_DOCUMENTS


def get_document_by_id(doc_id: str) -> dict | None:
    for doc in TELECOM_DOCUMENTS:
        if doc["id"] == doc_id:
            return doc
    return None
