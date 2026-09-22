# **1. Project Overview** 

- **Objective:** This platform acts as a complete, AI-driven management system (ERP) built specifically for small and medium-sized garment factories (MSMEs). Its main goal is to take messy, unstructured buyer messages—like plain emails and PDFs—and automatically turn them into clear, actionable steps for the factory floor. 

- **Target Audience:** The system is designed for factory owners, administrative staff, and operators working on the production floor. 

- **Success Metrics:** The project is successful if it can automatically read and organize incoming orders using AI without requiring human data entry. It must also protect the factory's profits by strictly enforcing minimum pricing margins during negotiations. Finally, it must prevent material shortages by automatically reserving inventory and ordering new supplies before they run out. Plan for the execution of the order as per the workflow of the factory.  

# **2. Scope and Boundaries** 

- **In Scope:** The final product will include automated order reading from emails and webhooks. It will use advanced AI (Groq Llama 3.3 70B and Gemini) to pull exact details from conversational text. The system will feature a dynamic pricing calculator based on a customized Bill of Materials (BOM). Additionally, it will schedule production based on factory capacity, track progress across different manufacturing stages, and provide a real-time dashboard for all users. 

# **3. Functional Requirements (The "What")** 
- **Sign up/ Sign in page:**
   - The first page has to be Sign up/Sign in page. With options to Sign if already registered, or sign up if not registered.
   - **User input for Sign in:** Email and Password for the user and sign in option
   - **User input for Sign up:** This will have two pages
            - 1. **Organization registration:**
                 - * Name of the organization/factory
                 - * Name of the owner
                 - * Official Email Id and phone number of the factory
                 - * Address of the factory
            - 2. **User registration:**
                 - * Name of the user
                 - * Role of the user
                 - * Email ID and phone number of the user
                 - * Employee ID  

- **Order Intake & Parsing:** 

   - The system must automatically capture incoming orders by monitoring a Gmail account in the background, receiving web hooks, or allowing manual entry on the dashboard. 

   - The AI component must accurately read the text to find key details: buyer name, delivery deadline, garment type, fabric type, color, total quantity, and the breakdown of specific sizes. 

   - If the AI is unsure about the data or if important details are missing, the system must pause the order and place it in a pending_review status. 

   - When an order is paused, the platform must automatically email the buyer to ask for the missing information. Once the buyer replies, the system must merge their new answer with the original order context to complete the booking. 

- **Dynamic Costing & Pricing Engine:** 

   - The software must calculate the total price of an order by adding up the costs of raw materials, expected material wastage, human labor, and general factory overhead. 

   - This calculation must enforce a strict minimum margin floor, meaning the system will never allow a quoted price that drops below the factory's required profit level. 

   - The system must allow admins to set unique manufacturing rules for different clothing items. For example, a denim jacket will have different labor minutes and wastage rules than a standard t-shirt. 

- **Production Scheduling & Inventory Management:** 

   - The scheduling engine must calculate exact completion dates based on realistic working hours, assuming an 8-hour shift for active workers and skipping nonworking days like Sundays. 

   - The system must track each garment batch through five specific production steps: cutting, stitching, finishing, quality check, and packing. 

   - Raw materials must be automatically deducted from the master inventory the moment a job moves from the queue into the cutting stage. 

   - If stock falls below a safe limit, the system must instantly generate a purchase order to buy more fabric or materials. 

# **4. Non-Functional Requirements (The "How Well")** 

- Performance: All dashboard information, such as production stage changes and lowstock alerts, must appear instantly on everyone's screen. This real-time syncing must use Socket.io so users never have to manually refresh their web browsers. 

- Alerting & Risk Management: The scheduling system must constantly compare the factory's expected completion date against the buyer's requested delivery deadline. If the factory does not have enough time or capacity to finish the order on time, the system must instantly alert the factory owner. 

- Scalability: The software must run smoothly even on older, low-resource factory computers. To achieve this, it will use an embedded local database (better-sqlite3) paired with a custom SQL normalizer. However, it must also include a migration script 

(supabase_migrations_needed.sql) so the factory can easily upgrade to a cloud-based PostgreSQL database as they scale up their operations. 

# **5. Technical Constraints & Environment** 

- **Frontend Stack:** The user interface must be built using Next.js 16 (App Router) and React 19. Styling will rely on Tailwind CSS v4 and Lucide Icons, with Recharts and Sonner used for visual graphs and pop-up notifications. 

- **Backend Stack:** The core server logic must be written in Node.js and Express.js, utilizing Socket.io for live updates. 

- **Database:** The primary storage will use better-sqlite3 alongside a custom wrapper to ensure compatibility with standard SQL queries. 

- **Integrations:** The platform must connect to the Groq SDK (specifically llama-3.3-70bversatile) and Google Generative AI for text processing. It also requires the GoogleAPIs (Gmail API) and Nodemailer to handle background email automation. 

# **6. Data Requirements** 

- **Data Inputs:** The system must be able to process messy, unstructured text sources, including plain emails, direct messages, and PDF bills or purchase orders. It also requires manual input for manufacturing rules, such as noting that denim jeans take 30 minutes to stitch while a t-shirt takes 10 minutes. 

- **Data Outputs:** The system must generate formatted purchase orders that tell suppliers exactly how much material to send to refill safety stocks. It must also output live, visual graphs via Recharts to show owners how fast orders are moving and exactly how much inventory is left. 

