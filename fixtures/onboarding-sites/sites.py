"""The onboarding eval's fixture businesses (chunk 20a). Every one is fictional: names,
people, numbers and addresses are made up, and email addresses use `.example`.

Each site has a theme colour and a logo, half have a sitemap, one robots.txt disallows a
path, and each leaves out 2–3 things its industry's checklist asks for (`gaps`), which
the builder should ask about. `expected` is what the eval checks.

Case 11 (Live Love Laugh) is a real, public mental health non-profit, read live from its
own site rather than copied here.
"""

SITES = [
    {
        "key": "mental-health",
        "port": 8701,
        "name": "Sunrise Mind Clinic",
        "colour": "#0F766E",
        "sitemap": True,
        "robots_disallow": "/staff-only",
        "expected": {"industry": "mental_health", "pack": "mental_health"},
        "gaps": ["fees", "cancellation"],
        "pages": {
            "/": (
                "Sunrise Mind Clinic — Counselling and therapy in Baner, Pune",
                """<h1>Sunrise Mind Clinic</h1>
<p>Sunrise Mind Clinic is a counselling and therapy practice in Baner, Pune, founded in 2019 by Dr Kavya Iyer. We work with adults and teenagers on anxiety, low mood, stress, relationships and life changes.</p>
<p>Sessions are available in person at our Baner clinic and online by video. We work in English, Hindi, Marathi and Tamil.</p>
<p>We are not a hospital or an emergency service. If you are in danger, call 112 or Tele-MANAS on 14416.</p>""",
            ),
            "/services": (
                "Services — Sunrise Mind Clinic",
                """<h1>Our services</h1>
<h2>Individual therapy</h2><p>One-to-one sessions of 50 minutes for adults, using CBT, ACT and person-centred approaches.</p>
<h2>Therapy for teenagers</h2><p>Sessions for young people aged 13 to 17, with a parent or guardian involved in the first session.</p>
<h2>Couples therapy</h2><p>Joint sessions of 75 minutes for couples working through conflict, trust or big decisions.</p>
<h2>Group workshops</h2><p>Monthly workshops on stress and sleep, limited to 12 people.</p>""",
            ),
            "/team": (
                "Our team — Sunrise Mind Clinic",
                """<h1>Our team</h1>
<h3>Dr Kavya Iyer</h3><p>Clinical Psychologist and founder. Works with anxiety, depression and trauma. Languages: English, Hindi, Tamil.</p>
<h3>Rohan Deshpande</h3><p>Counselling Psychologist. Works with stress, burnout and relationships. Languages: English, Marathi, Hindi.</p>
<h3>Sara Fernandes</h3><p>Couples and Family Therapist. Works with couples, family conflict and parenting. Languages: English, Konkani.</p>""",
            ),
            "/contact": (
                "Contact — Sunrise Mind Clinic",
                """<h1>Contact us</h1>
<p>Sunrise Mind Clinic, 2nd floor, Orchid Plaza, Baner Road, Pune 411045.</p>
<p>Phone: +91 20 0000 4400. Email: hello@sunrisemind.example</p>
<h2>Opening hours</h2><p>Monday to Saturday, 9 am to 7 pm. Closed on Sundays.</p>""",
            ),
            "/faq": (
                "Questions — Sunrise Mind Clinic",
                """<h1>Common questions</h1>
<h3>How do I start?</h3><p>Call or email us and we will arrange a first session with the therapist who fits best.</p>
<h3>Is what I say confidential?</h3><p>Yes. What you share stays between you and your therapist, except where someone's safety is at risk.</p>
<h3>Do you prescribe medicine?</h3><p>No. Our therapists do not prescribe. We can refer you to a psychiatrist if needed.</p>""",
            ),
        },
    },
    {
        "key": "gp-clinic",
        "port": 8702,
        "name": "Lakeview Family Clinic",
        "colour": "#1D4ED8",
        "sitemap": False,
        "expected": {"industry": "gp_clinic", "pack": "medical"},
        "gaps": ["insurance", "emergency"],
        "pages": {
            "/": (
                "Lakeview Family Clinic — Family doctors in Indiranagar",
                """<h1>Lakeview Family Clinic</h1>
<p>Lakeview Family Clinic is a family practice in Indiranagar, Bengaluru. Our doctors see children and adults for everyday illness, check-ups, vaccinations and long-term conditions such as diabetes and blood pressure.</p>""",
            ),
            "/doctors": (
                "Our doctors — Lakeview Family Clinic",
                """<h1>Our doctors</h1>
<h3>Dr Meera Nair</h3><p>General practitioner, MBBS, MD. Special interest in diabetes care.</p>
<h3>Dr Arjun Rao</h3><p>Paediatrician, MBBS, DCH. Sees children from birth to 16.</p>
<h3>Dr Farah Khan</h3><p>General practitioner with an interest in women's health.</p>""",
            ),
            "/services": (
                "Services — Lakeview Family Clinic",
                """<h1>Services</h1>
<p>General consultations cost ₹700. Child vaccinations follow the IAP schedule; vaccine prices vary.</p>
<p>Annual health check-up packages start at ₹2,500 and include blood tests and a doctor's review.</p>
<p>We also offer diabetes and blood pressure follow-up clinics every Tuesday and Thursday.</p>""",
            ),
            "/visit": (
                "Visit us — Lakeview Family Clinic",
                """<h1>Visit us</h1>
<p>12, 100 Feet Road, Indiranagar, Bengaluru 560038. Phone: +91 80 0000 2211. Email: care@lakeviewclinic.example</p>
<h2>Hours</h2><p>Monday to Saturday, 8 am to 8 pm. Sunday, 9 am to 1 pm.</p>
<p>Walk-ins are welcome; appointments are seen first.</p>""",
            ),
        },
    },
    {
        "key": "diagnostic-lab",
        "port": 8703,
        "name": "ClearPath Diagnostics",
        "colour": "#7C3AED",
        "sitemap": True,
        "expected": {"industry": "diagnostic_lab", "pack": "medical"},
        "gaps": ["report_times", "home_collection"],
        "pages": {
            "/": (
                "ClearPath Diagnostics — Pathology and imaging in Andheri",
                """<h1>ClearPath Diagnostics</h1>
<p>ClearPath Diagnostics is a NABL-accredited pathology lab and imaging centre in Andheri West, Mumbai.</p>
<p>We run blood and urine tests, X-rays, ultrasound and ECGs, with a doctor's referral or without.</p>""",
            ),
            "/tests": (
                "Tests and prices — ClearPath Diagnostics",
                """<h1>Tests and prices</h1>
<p>Complete blood count: ₹350. Thyroid profile (T3, T4, TSH): ₹600. HbA1c: ₹450. Lipid profile: ₹550.</p>
<p>Full body check-up (62 tests): ₹2,999. Chest X-ray: ₹500. Abdominal ultrasound: ₹1,400.</p>
<p>Fasting tests need 10 to 12 hours without food; water is fine.</p>""",
            ),
            "/about": (
                "About — ClearPath Diagnostics",
                """<h1>About us</h1>
<p>Founded in 2011 by Dr Sanjay Kulkarni, pathologist. Our lab processes over 800 samples a day.</p>
<p>Every report is reviewed and signed by a pathologist before it is released.</p>""",
            ),
            "/contact": (
                "Contact — ClearPath Diagnostics",
                """<h1>Contact</h1>
<p>Shop 4, Link Plaza, New Link Road, Andheri West, Mumbai 400053.</p>
<p>Phone: +91 22 0000 7788. Email: reports@clearpath.example</p>
<p>Open every day, 7 am to 9 pm.</p>""",
            ),
        },
    },
    {
        "key": "pharmacy",
        "port": 8704,
        "name": "GoodHealth Pharmacy",
        "colour": "#15803D",
        "sitemap": False,
        "expected": {"industry": "pharmacy", "pack": "pharmacy"},
        "gaps": ["delivery", "prescriptions"],
        "pages": {
            "/": (
                "GoodHealth Pharmacy — Your neighbourhood chemist in Salt Lake",
                """<h1>GoodHealth Pharmacy</h1>
<p>GoodHealth Pharmacy is a family-run chemist in Salt Lake, Kolkata, open since 1998.</p>
<p>We stock prescription medicines, over-the-counter remedies, baby care, diabetic supplies and health devices such as BP monitors and glucometers.</p>""",
            ),
            "/products": (
                "What we stock — GoodHealth Pharmacy",
                """<h1>What we stock</h1>
<p>Prescription and generic medicines from all major brands.</p>
<p>Diabetic care: test strips, lancets and insulin pens. Devices: blood pressure monitors, thermometers, nebulisers.</p>
<p>Baby care and personal care. Ayurvedic products from Dabur and Himalaya.</p>""",
            ),
            "/store": (
                "Our store — GoodHealth Pharmacy",
                """<h1>Our store</h1>
<p>BD-14, Sector 1, Salt Lake, Kolkata 700064. Phone: +91 33 0000 5150.</p>
<p>Open Monday to Sunday, 8 am to 11 pm.</p>
<p>Our pharmacists are registered with the West Bengal Pharmacy Council.</p>""",
            ),
        },
    },
    {
        "key": "wellness",
        "port": 8705,
        "name": "Prana Yoga Studio",
        "colour": "#B45309",
        "sitemap": True,
        "expected": {"industry": "wellness", "pack": "standard"},
        "gaps": ["fees", "cancellation"],
        "pages": {
            "/": (
                "Prana Yoga Studio — Yoga classes in Koramangala",
                """<h1>Prana Yoga Studio</h1>
<p>Prana Yoga Studio teaches Hatha, Vinyasa and Yin yoga in Koramangala, Bengaluru, for beginners and regular practitioners.</p>""",
            ),
            "/classes": (
                "Classes and timetable — Prana Yoga Studio",
                """<h1>Classes</h1>
<p>Morning Hatha: Monday, Wednesday and Friday, 6:30 to 7:30 am.</p>
<p>Evening Vinyasa: Tuesday and Thursday, 7 to 8 pm.</p>
<p>Weekend Yin: Saturday, 9 to 10:15 am. Beginners' series: four Sundays each month, 8 am.</p>""",
            ),
            "/teachers": (
                "Teachers — Prana Yoga Studio",
                """<h1>Our teachers</h1>
<h3>Ananya Rao</h3><p>Founder, 500-hour certified, teaching since 2012.</p>
<h3>Vikram Shetty</h3><p>Vinyasa and strength, 200-hour certified.</p>""",
            ),
            "/contact": (
                "Contact — Prana Yoga Studio",
                """<h1>Find us</h1>
<p>3rd floor, 80 Feet Road, Koramangala 4th Block, Bengaluru 560034.</p>
<p>Phone: +91 80 0000 6060. Email: namaste@pranayoga.example</p>""",
            ),
        },
    },
    {
        "key": "d2c",
        "port": 8706,
        "name": "Kesar Teas",
        "colour": "#BE123C",
        "sitemap": False,
        "expected": {"industry": "d2c", "pack": "standard"},
        "gaps": ["returns", "shipping"],
        "pages": {
            "/": (
                "Kesar Teas — Small-batch Assam and Darjeeling teas",
                """<h1>Kesar Teas</h1>
<p>Kesar Teas sells small-batch loose-leaf teas from family gardens in Assam and Darjeeling, packed within a month of plucking.</p>""",
            ),
            "/shop": (
                "Shop — Kesar Teas",
                """<h1>Our teas</h1>
<p>Assam Breakfast, 250 g: ₹520. Darjeeling First Flush, 100 g: ₹690. Masala Chai blend, 250 g: ₹480.</p>
<p>Tasting box of six 25 g teas: ₹799. Every tea comes in a resealable foil pouch.</p>""",
            ),
            "/story": (
                "Our story — Kesar Teas",
                """<h1>Our story</h1>
<p>Kesar Teas was started in 2020 by siblings Nikhil and Priya Baruah, whose family has grown tea near Dibrugarh for three generations.</p>""",
            ),
            "/help": (
                "Help — Kesar Teas",
                """<h1>Help</h1>
<h3>How should I store tea?</h3><p>Keep it sealed, away from light and strong smells. It stays fresh for about 12 months.</p>
<h3>How do I contact you?</h3><p>Email hello@kesarteas.example or WhatsApp +91 98000 11223, 10 am to 6 pm on weekdays.</p>""",
            ),
        },
    },
    {
        "key": "coaching",
        "port": 8707,
        "name": "Bright Minds Academy",
        "colour": "#0369A1",
        "sitemap": True,
        "expected": {"industry": "coaching", "pack": "minors"},
        "gaps": ["fees", "admissions"],
        "pages": {
            "/": (
                "Bright Minds Academy — Coaching for Class 8 to 12 in Kothrud",
                """<h1>Bright Minds Academy</h1>
<p>Bright Minds Academy coaches students in Class 8 to 12 for school exams, JEE and NEET, in Kothrud, Pune.</p>""",
            ),
            "/courses": (
                "Courses — Bright Minds Academy",
                """<h1>Courses</h1>
<p>Foundation (Class 8 to 10): Maths and Science, three evenings a week.</p>
<p>JEE (Class 11 and 12): Physics, Chemistry and Maths, six days a week with weekly tests.</p>
<p>NEET (Class 11 and 12): Physics, Chemistry and Biology, six days a week.</p>""",
            ),
            "/batches": (
                "Batch timings — Bright Minds Academy",
                """<h1>Batch timings</h1>
<p>Morning batch: 7 to 10 am. Evening batch: 5 to 8 pm. Weekend doubt-clearing: Sunday 10 am to 1 pm.</p>""",
            ),
            "/contact": (
                "Contact — Bright Minds Academy",
                """<h1>Contact</h1>
<p>Second floor, Paud Road, Kothrud, Pune 411038. Phone: +91 20 0000 3344. Email: info@brightminds.example</p>
<p>Office hours: Monday to Saturday, 10 am to 7 pm.</p>""",
            ),
        },
    },
    {
        "key": "real-estate",
        "port": 8708,
        "name": "Greenfield Homes",
        "colour": "#4D7C0F",
        "sitemap": False,
        "expected": {"industry": "real_estate", "pack": "standard"},
        "gaps": ["site_visits", "prices"],
        "pages": {
            "/": (
                "Greenfield Homes — 2 and 3 BHK homes in Whitefield",
                """<h1>Greenfield Homes</h1>
<p>Greenfield Homes is building Greenfield Meadows, 240 homes in 2 and 3 BHK layouts near Whitefield, Bengaluru, with possession from June 2027.</p>""",
            ),
            "/project": (
                "Greenfield Meadows — Greenfield Homes",
                """<h1>Greenfield Meadows</h1>
<p>Two towers of 14 floors on 3.2 acres. 2 BHK homes of 1,150 sq ft and 3 BHK homes of 1,540 sq ft.</p>
<p>Clubhouse, pool, children's play area, and a 1 km walking track. RERA number: PRM/KA/RERA/0000/0000.</p>""",
            ),
            "/location": (
                "Location — Greenfield Homes",
                """<h1>Location</h1>
<p>Off Varthur Road, 2 km from Whitefield metro station. Sales office: Greenfield Meadows site, Varthur Road, Bengaluru 560066.</p>
<p>Phone: +91 80 0000 9090. Email: sales@greenfieldhomes.example</p>""",
            ),
        },
    },
    {
        "key": "saas",
        "port": 8709,
        "name": "Ledgerly",
        "colour": "#4338CA",
        "sitemap": True,
        "expected": {"industry": "saas", "pack": "standard"},
        "gaps": ["pricing", "support_hours"],
        "pages": {
            "/": (
                "Ledgerly — Invoicing and GST for small businesses",
                """<h1>Ledgerly</h1>
<p>Ledgerly is invoicing and GST filing software for small businesses in India. Create invoices, track payments and file GSTR-1 from one place.</p>""",
            ),
            "/help/invoices": (
                "Creating invoices — Ledgerly Help",
                """<h1>Creating invoices</h1>
<p>Go to Invoices, then New invoice. Add your customer, items and tax rates. Ledgerly works out CGST, SGST or IGST from the customer's state.</p>
<p>You can send an invoice by email or WhatsApp, or download it as a PDF.</p>""",
            ),
            "/help/gst": (
                "Filing GSTR-1 — Ledgerly Help",
                """<h1>Filing GSTR-1</h1>
<p>Under Returns, choose the month and review the summary. Connect your GSTN account once, then file directly from Ledgerly.</p>""",
            ),
            "/help/account": (
                "Your account — Ledgerly Help",
                """<h1>Your account</h1>
<p>To add a team member, go to Settings, then Team, and send an invite. You can export all your data as Excel from Settings, then Export.</p>
<p>Write to support@ledgerly.example for help.</p>""",
            ),
        },
    },
    {
        "key": "restaurant",
        "port": 8710,
        "name": "Coastal Spice Kitchen",
        "colour": "#C2410C",
        "sitemap": False,
        "expected": {"industry": "restaurant", "pack": "standard"},
        "gaps": ["reservations", "delivery"],
        "pages": {
            "/": (
                "Coastal Spice Kitchen — Mangalorean and Goan food in Bandra",
                """<h1>Coastal Spice Kitchen</h1>
<p>Coastal Spice Kitchen serves Mangalorean and Goan seafood in Bandra West, Mumbai, with vegetarian dishes from the same coast.</p>""",
            ),
            "/menu": (
                "Menu — Coastal Spice Kitchen",
                """<h1>Menu</h1>
<p>Prawn gassi with neer dosa: ₹540. Kori rotti: ₹480. Goan fish curry rice: ₹460. Mushroom xacuti: ₹380.</p>
<p>Desserts: bebinca ₹220, tender coconut payasam ₹180.</p>""",
            ),
            "/visit": (
                "Visit — Coastal Spice Kitchen",
                """<h1>Visit us</h1>
<p>Ground floor, 17 Chapel Road, Bandra West, Mumbai 400050. Phone: +91 22 0000 6612.</p>
<p>Open Tuesday to Sunday, 12 to 3:30 pm and 7 to 11:30 pm. Closed on Mondays.</p>""",
            ),
        },
    },
]

#: Robots.txt disallows everything: the builder should stop and say so (copy §13).
BLOCKED = {"key": "blocked", "port": 8711, "name": "Private Practice"}
#: Nothing listens here: "We couldn't reach …" (copy §13).
UNREACHABLE_PORT = 8712

#: Case 11: a real mental health non-profit, read from its own public site.
LIVE_CASES = [
    {
        "key": "live-love-laugh",
        "url": "https://www.thelivelovelaughfoundation.org/",
        "expected": {"industry": "non_profit", "pack": "mental_health"},
        "gaps": [],
    }
]
