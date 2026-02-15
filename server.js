const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all interfaces
const CLIENT_URL = process.env.CLIENT_URL || 'https://jobseeker-pk-edu.up.railway.app';
const JWT_SECRET = 'job-portal-secret-key-2024';
const RESET_TOKEN_SECRET = 'reset-token-secret-key-2024';

// Email configuration (simulated - in production use nodemailer)
const emailConfig = {
    from: 'noreply@jobportal.com',
    subject: 'Password Reset - Job Portal'
};

// In-memory storage for password reset tokens
const passwordResetTokens = new Map(); // email -> { token, expiresAt }

// In-memory storage for email verification codes
const emailVerificationCodes = new Map(); // email -> { code, expiresAt }

// ==================== EMAIL UTILITIES ====================

// Generate a 4-digit verification code
function generateVerificationCode() {
    return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
}

// Store verification code with expiration (5 minutes)
function storeVerificationCode(email, code) {
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    emailVerificationCodes.set(email, { code, expiresAt });
    return expiresAt;
}

// Validate verification code
function validateVerificationCode(email, code) {
    const verificationData = emailVerificationCodes.get(email);
    if (!verificationData) {
        return { valid: false, error: 'No verification code found. Please request a new code.' };
    }
    if (Date.now() > verificationData.expiresAt) {
        emailVerificationCodes.delete(email);
        return { valid: false, error: 'Verification code has expired. Please request a new code.' };
    }
    if (verificationData.code !== code) {
        return { valid: false, error: 'Invalid verification code. Please try again.' };
    }
    // Code is valid, remove it (one-time use)
    emailVerificationCodes.delete(email);
    return { valid: true };
}

// Generate a secure random token
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Store reset token with expiration (24 hours)
function storeResetToken(email, token) {
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    passwordResetTokens.set(email, { token, expiresAt });
    return expiresAt;
}

// Validate and consume reset token
function validateResetToken(email, token) {
    const resetData = passwordResetTokens.get(email);
    if (!resetData) {
        return false;
    }
    if (Date.now() > resetData.expiresAt) {
        passwordResetTokens.delete(email);
        return false;
    }
    if (resetData.token !== token) {
        return false;
    }
    // Token is valid, remove it (one-time use)
    passwordResetTokens.delete(email);
    return true;
}

// Email notification templates
const emailTemplates = {
    emailVerification: (code) => ({
        subject: 'Email Verification - Job Portal',
        body: `Welcome to Job Portal!

Your email verification code is: ${code}

This code will expire in 10 minutes.

If you didn't create an account, please ignore this email.

Best regards,
Job Portal Team`
    }),

    applicationReceived: (job, candidate) => ({
        subject: 'Application Received - Job Portal',
        body: `Dear ${candidate.name || 'Candidate'},

Thank you for applying for the position of ${job.title} at ${job.employerName || 'our company'}.

We have received your application and our team will review it shortly.

Job Details:
- Position: ${job.title}
- Location: ${job.location}
- Applied Date: ${new Date().toLocaleDateString()}

Best regards,
Job Portal Team`
    }),

    applicationUpdate: (application, job, status) => ({
        subject: `Application Update: ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        body: `Dear ${application.employeeName},

Your application for the position of ${job.title} has been updated.

New Status: ${status.charAt(0).toUpperCase() + status.slice(1)}

${status === 'interview' ? 'Congratulations! You have been selected for an interview. We will contact you shortly with the details.' :
          status === 'accepted' ? 'Congratulations! Your application has been accepted. Our HR team will reach out to you soon.' :
          status === 'rejected' ? 'Thank you for your interest. Unfortunately, we have decided to move forward with other candidates. We encourage you to apply for other positions that match your skills.' :
          'Your application is currently being reviewed.'}

Best regards,
Job Portal Team`
    }),

    jobPosted: (job) => ({
        subject: 'Job Posted Successfully - Job Portal',
        body: `Dear ${job.employerName},

Your job posting has been successfully created and is now live on Job Portal.

Job Details:
- Position: ${job.title}
- Category: ${job.category}
- Location: ${job.location}
- Job Type: ${job.jobType}
${job.salary ? `- Salary: ${job.salary}` : ''}

Candidates can now view and apply for this position.

Best regards,
Job Portal Team`
    }),

    newApplication: (job, candidate) => ({
        subject: `New Application Received - ${job.title}`,
        body: `Dear ${job.employerName},

You have received a new application for the position of ${job.title}.

Candidate Details:
- Name: ${candidate.employeeName}
- Email: ${candidate.employeeEmail}
${candidate.employeeProfile?.skills ? `- Skills: ${candidate.employeeProfile.skills.join(', ')}` : ''}
${candidate.employeeProfile?.desiredJobTitle ? `- Desired Position: ${candidate.employeeProfile.desiredJobTitle}` : ''}

Log in to your employer dashboard to review the application.

Best regards,
Job Portal Team`
    })
};

// Simulate sending email (in production, use nodemailer or similar)
function sendEmail(to, subject, body) {
    console.log('\n========== EMAIL SENT ==========');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
    console.log('===============================\n');
    return true;
}

// Skills Assessment Questions Database
const skillsQuestions = {
    'IT': [
        { id: 1, question: 'What does HTML stand for?', options: ['Hyper Text Markup Language', 'High Tech Modern Language', 'Hyper Transfer Markup Language', 'Home Tool Markup Language'], answer: 0 },
        { id: 2, question: 'Which programming language is known as the scripting language for the web?', options: ['Java', 'Python', 'JavaScript', 'C++'], answer: 2 },
        { id: 3, question: 'What is the correct way to declare a variable in JavaScript?', options: ['var x = 5;', 'variable x = 5;', 'v x = 5;', 'declare x = 5;'], answer: 0 },
        { id: 4, question: 'What is Git?', options: ['A programming language', 'A version control system', 'A database', 'An operating system'], answer: 1 },
        { id: 5, question: 'Which of the following is a NoSQL database?', options: ['MySQL', 'PostgreSQL', 'MongoDB', 'Oracle'], answer: 2 },
        { id: 6, question: 'What is CSS used for?', options: ['Designing database schemas', 'Debugging code', 'Styling web pages', 'Server-side programming'], answer: 2 },
        { id: 7, question: 'What is an API?', options: ['Application Programming Interface', 'Automated Program Integration', 'Application Process Integration', 'Automated Programming Interface'], answer: 0 },
        { id: 8, question: 'What is the purpose of a loop in programming?', options: ['To store data', 'To make decisions', 'To repeat code', 'To define functions'], answer: 2 },
        { id: 9, question: 'What is cloud computing?', options: ['Programming for weather apps', 'Using remote servers for storage and processing', 'A type of computer hardware', 'A programming language'], answer: 1 },
        { id: 10, question: 'What is cybersecurity?', options: ['Protecting computer systems from theft', 'Designing user interfaces', 'Writing code documentation', 'Testing software'], answer: 0 }
    ],
    'Marketing': [
        { id: 1, question: 'What is the 4Ps of marketing?', options: ['Product, Price, Place, Promotion', 'People, Process, Performance, Profit', 'Planning, Processing, Purchasing, Promotion', 'Product, People, Price, Process'], answer: 0 },
        { id: 2, question: 'What is SEO?', options: ['Search Engine Optimization', 'Social Media Engagement', 'Sales Enhancement Option', 'Strategic Email Operation'], answer: 0 },
        { id: 3, question: 'What does KPI stand for?', options: ['Key Performance Indicator', 'Knowledge Processing Index', 'Key Process Integration', 'Knowledge Performance Index'], answer: 0 },
        { id: 4, question: 'What is a target audience?', options: ['A group of competitors', 'A specific group of consumers', 'A marketing team', 'A sales strategy'], answer: 1 },
        { id: 5, question: 'What is content marketing?', options: ['Creating content only for social media', 'Writing product descriptions', 'Creating and sharing valuable content', 'Advertising products'], answer: 2 },
        { id: 6, question: 'What is a brand?', options: ['A company logo', 'A product name', 'The identity and perception of a company', 'A type of product'], answer: 2 },
        { id: 7, question: 'What is market research?', options: ['Selling products', 'Gathering information about customers and market', 'Marketing to competitors', 'Creating advertisements'], answer: 1 },
        { id: 8, question: 'What is a marketing funnel?', options: ['A sales tool', 'A visualization of customer journey', 'A pricing strategy', 'A product design'], answer: 1 },
        { id: 9, question: 'What is email marketing?', options: ['Sending spam emails', 'Sending targeted emails to prospects', 'Writing business letters', 'Creating email software'], answer: 1 },
        { id: 10, question: 'What is social media marketing?', options: ['Using social platforms for advertising', 'Creating social networks', 'Testing products', 'Managing customer service'], answer: 0 }
    ],
    'Design': [
        { id: 1, question: 'What does UI stand for?', options: ['User Interface', 'Universal Input', 'Unified Integration', 'User Input'], answer: 0 },
        { id: 2, question: 'What does UX stand for?', options: ['User Experience', 'Universal Exchange', 'User Extension', 'Unified Experience'], answer: 0 },
        { id: 3, question: 'What is a color wheel?', options: ['A software tool', 'A circular representation of colors', 'A drawing tool', 'A font type'], answer: 1 },
        { id: 4, question: 'What is typography?', options: ['Writing code', 'The art of arranging text', 'Creating logos', 'Building websites'], answer: 1 },
        { id: 5, question: 'What is whitespace in design?', options: ['White colored areas only', 'Empty space between elements', 'Background color', 'A software tool'], answer: 1 },
        { id: 6, question: 'What is a wireframe?', options: ['A coding framework', 'A basic visual guide', 'A font style', 'A color palette'], answer: 1 },
        { id: 7, question: 'What is responsive design?', options: ['Designing for mobile only', 'Creating adaptive layouts for different devices', 'A graphic design style', 'A typography technique'], answer: 1 },
        { id: 8, question: 'What are complementary colors?', options: ['Colors that are the same', 'Colors opposite on the color wheel', 'Primary colors', 'Dark colors'], answer: 1 },
        { id: 9, question: 'What is hierarchy in design?', options: ['A company structure', 'Visual arrangement to show importance', 'A font style', 'A color theory'], answer: 1 },
        { id: 10, question: 'What is a portfolio?', options: ['A collection of work samples', 'A design software', 'A color palette', 'A font type'], answer: 0 }
    ],
    'Finance': [
        { id: 1, question: 'What is ROI?', options: ['Rate of Investment', 'Return on Investment', 'Revenue of Income', 'Return on Income'], answer: 1 },
        { id: 2, question: 'What is a balance sheet?', options: ['A sheet that balances', 'A financial statement showing assets and liabilities', 'A tax form', 'A bank statement'], answer: 1 },
        { id: 3, question: 'What is inflation?', options: ['Increase in prices over time', 'Decrease in economy', 'A type of tax', 'A government policy'], answer: 0 },
        { id: 4, question: 'What is compound interest?', options: ['Simple calculation', 'Interest calculated on initial principal and accumulated interest', 'A fixed rate', 'A tax form'], answer: 1 },
        { id: 5, question: 'What is a budget?', options: ['A yearly plan', 'A plan for income and expenses', 'A tax return', 'A bank account'], answer: 1 },
        { id: 6, question: 'What is diversification?', options: ['Focusing on one investment', 'Spreading investments to reduce risk', 'A banking service', 'A tax strategy'], answer: 1 },
        { id: 7, question: 'What is a stock?', options: ['A type of bond', 'A share in company ownership', 'A currency', 'A real estate property'], answer: 1 },
        { id: 8, question: 'What is a credit score?', options: ['A loan amount', 'A numerical representation of creditworthiness', 'A bank account number', 'A salary amount'], answer: 1 },
        { id: 9, question: 'What is a audit?', options: ['A financial investigation', 'A tax form', 'A loan application', 'A bank service'], answer: 0 },
        { id: 10, question: 'What is profit?', options: ['Total revenue', 'Money gained after expenses', 'A business type', 'A tax'], answer: 1 }
    ],
    'Sales': [
        { id: 1, question: 'What is a sales funnel?', options: ['A product delivery system', 'A visual representation of the sales process', 'A pricing strategy', 'A marketing campaign'], answer: 1 },
        { id: 2, question: 'What is a lead?', options: ['A potential customer', 'A sales manager', 'A product type', 'A store location'], answer: 0 },
        { id: 3, question: 'What is closing in sales?', options: ['Ending a conversation', 'Completing a sale', 'Closing a store', 'Taking inventory'], answer: 1 },
        { id: 4, question: 'What is a value proposition?', options: ['A product price', 'A statement explaining why customer should buy', 'A sales pitch', 'A marketing slogan'], answer: 1 },
        { id: 5, question: 'What is CRM?', options: ['Customer Relationship Management', 'Sales Reporting Method', 'Company Resource Management', 'Client Retention Measure'], answer: 0 },
        { id: 6, question: 'What is cold calling?', options: ['Calling in winter', 'Contacting potential customers who have not expressed interest', 'Calling existing customers', 'A marketing technique'], answer: 1 },
        { id: 7, question: 'What is upselling?', options: ['Selling at a higher price', 'Encouraging customers to buy more expensive items', 'A discount technique', 'A product bundle'], answer: 1 },
        { id: 8, question: 'What is a quota?', options: ['A sales target', 'A type of discount', 'A product category', 'A customer type'], answer: 0 },
        { id: 9, question: 'What is objection handling?', options: ['Dealing with customer concerns', 'Solving technical problems', 'Managing returns', 'Processing complaints'], answer: 0 },
        { id: 10, question: 'What is follow-up?', options: ['A final meeting', 'Continuing communication with prospects', 'A sales report', 'A product update'], answer: 1 }
    ],
    'HR': [
        { id: 1, question: 'What is recruitment?', options: ['Hiring new employees', 'Training staff', 'Firing employees', 'Managing payroll'], answer: 0 },
        { id: 2, question: 'What is an interview?', options: ['A formal meeting to evaluate candidates', 'A performance review', 'A salary negotiation', 'A training session'], answer: 0 },
        { id: 3, question: 'What is performance appraisal?', options: ['Evaluating employee performance', 'Appraising company assets', 'Reviewing products', 'Assessing market value'], answer: 0 },
        { id: 4, question: 'What is employee engagement?', options: ['Hiring process', 'The involvement and enthusiasm of employees', 'A training program', 'A benefits package'], answer: 1 },
        { id: 5, question: 'What is onboarding?', options: ['The process of integrating new employees', 'Ending employment', 'A performance review', 'A salary discussion'], answer: 0 },
        { id: 6, question: 'What is a job description?', options: ['A list of job openings', 'A document detailing job responsibilities', 'A employee contract', 'A company policy'], answer: 1 },
        { id: 7, question: 'What is workplace culture?', options: ['Office decorations', 'The environment and values of an organization', 'A dress code', 'A company logo'], answer: 1 },
        { id: 8, question: 'What is employee retention?', options: ['Keeping employees in the organization', 'A training program', 'A performance metric', 'A benefit plan'], answer: 0 },
        { id: 9, question: 'What is training and development?', options: ['Firing underperforming employees', 'Improving employee skills and knowledge', 'A recruitment method', 'A compensation strategy'], answer: 1 },
        { id: 10, question: 'What is conflict resolution?', options: ['A hiring process', 'Finding solutions to workplace disagreements', 'A performance review', 'A termination procedure'], answer: 1 }
    ],
    'Engineering': [
        { id: 1, question: 'What is the first law of thermodynamics?', options: ['Energy cannot be created or destroyed', 'Energy can be created', 'Energy decreases over time', 'Energy increases forever'], answer: 0 },
        { id: 2, question: 'What is CAD?', options: ['Computer Aided Design', 'Computer Application Development', 'Computer Analysis Data', 'Computer Algorithm Design'], answer: 0 },
        { id: 3, question: 'What is stress in materials?', options: ['Mental pressure', 'Force per unit area', 'A type of strain', 'A manufacturing defect'], answer: 1 },
        { id: 4, question: 'What is a lever?', options: ['A simple machine', 'A measurement unit', 'A type of material', 'A power source'], answer: 0 },
        { id: 5, question: 'What is Ohm\'s law?', options: ['V = IR', 'E = mc²', 'F = ma', 'PV = nRT'], answer: 0 },
        { id: 6, question: 'What is a pulley?', options: ['A lifting device', 'A measuring tool', 'A power source', 'A material type'], answer: 0 },
        { id: 7, question: 'What is tensile strength?', options: ['The ability to conduct electricity', 'The maximum stress a material can withstand', 'The ability to resist heat', 'The flexibility of a material'], answer: 1 },
        { id: 8, question: 'What is a gear?', options: ['A rotating machine element', 'A measurement tool', 'A power source', 'A safety device'], answer: 0 },
        { id: 9, question: 'What is structural analysis?', options: ['Analyzing chemical compounds', 'Examining the behavior of structures under loads', 'Testing materials', 'Designing circuits'], answer: 1 },
        { id: 10, question: 'What is thermodynamics?', options: ['The study of heat and work', 'The study of motion', 'The study of electricity', 'The study of materials'], answer: 0 }
    ]
};

const defaultQuestions = [
    { id: 1, question: 'What is your career goal?', options: ['Find a job', 'Build skills', 'Advance career', 'Start business'], answer: 0 },
    { id: 2, question: 'How many years of experience do you have?', options: ['None (Fresh Graduate)', '1-2 years', '3-5 years', '5+ years'], answer: 0 },
    { id: 3, question: 'What is your education level?', options: ['High School', 'Bachelor\'s Degree', 'Master\'s Degree', 'PhD'], answer: 1 },
    { id: 4, question: 'Are you currently employed?', options: ['Yes, employed', 'No, seeking opportunities', 'Self-employed', 'Student'], answer: 1 },
    { id: 5, question: 'What is your preferred work arrangement?', options: ['Remote', 'On-site', 'Hybrid', 'Flexible'], answer: 0 }
];

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create directories
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        if (extname) {
            return cb(null, true);
        }
        cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// In-memory database
const db = {
    users: [],
    jobs: [],
    applications: []
};

// Create default admin user synchronously (non-async)
const createDefaultAdmin = async () => {
    const adminEmail = 'admin@jobportal.com';
    const adminExists = db.users.find(u => u.email === adminEmail);
    
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('admin', 10);
        const adminUser = {
            id: uuidv4(),
            email: adminEmail,
            password: hashedPassword,
            role: 'admin',
            name: 'System Administrator',
            createdAt: new Date().toISOString(),
            profile: null,
            isActive: true,
            status: 'active',
            addedBy: 'system'
        };
        db.users.push(adminUser);
        console.log('Default admin user created: admin@jobportal.com / admin');
    }
};

// Initialize default admin
createDefaultAdmin();

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token.' });
    }
};

// ==================== AUTH ROUTES ====================

// Signup
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, role, name, designation } = req.body;
        
        // Check if user exists
        if (db.users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = {
            id: uuidv4(),
            email,
            password: hashedPassword,
            role: role || 'employee', // 'employee', 'employer', 'management'
            name,
            designation: designation || null,
            createdAt: new Date().toISOString(),
            profile: null,
            isVerified: true,
            isActive: true,
            status: 'active'
        };
        
        db.users.push(user);
        
        // Generate token
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        
        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: { id: user.id, email: user.email, role: user.role, name: user.name, designation: user.designation, profileComplete: false }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error creating user: ' + error.message });
    }
});

// Verify email with code
app.post('/api/auth/verify-email', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and verification code are required' });
        }
        
        // Validate verification code
        const validation = validateVerificationCode(email, code);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        // Find user and mark as verified
        const user = db.users.find(u => u.email === email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        user.isVerified = true;
        user.status = 'active';
        
        // Generate token for auto-login
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            message: 'Email verified successfully!',
            token,
            user: { id: user.id, email: user.email, role: user.role, name: user.name }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error verifying email: ' + error.message });
    }
});

// Resend verification code
app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        // Find user
        const user = db.users.find(u => u.email === email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.isVerified === true) {
            return res.json({ message: 'Email is already verified. You can login now.' });
        }
        
        // Generate new verification code
        const verificationCode = generateVerificationCode();
        storeVerificationCode(email, verificationCode);
        
        // Send verification email (simulated)
        const verificationEmail = emailTemplates.emailVerification(verificationCode);
        sendEmail(email, verificationEmail.subject, verificationEmail.body);
        
        res.json({
            message: 'A new verification code has been sent to your email',
            expiresIn: '5 minutes'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error resending verification code: ' + error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email/username and password are required' });
        }
        
        // Check if input is email or username
        const isEmail = email.includes('@');
        
        // Admin login check FIRST (username: admin, password: admin)
        // This must be before the regular user lookup
        if (!isEmail && email.toLowerCase() === 'admin' && password === 'admin') {
            // Find or create admin
            let adminUser = db.users.find(u => u.email === 'admin@jobportal.com');
            
            if (!adminUser) {
                const hashedPassword = await bcrypt.hash('admin', 10);
                adminUser = {
                    id: uuidv4(),
                    email: 'admin@jobportal.com',
                    password: hashedPassword,
                    role: 'admin',
                    name: 'System Administrator',
                    createdAt: new Date().toISOString(),
                    profile: null,
                    isActive: true,
                    status: 'active',
                    addedBy: 'system'
                };
                db.users.push(adminUser);
                console.log('Default admin user created: admin@jobportal.com / admin');
            }
            
            // Generate token for admin
            const token = jwt.sign({ 
                id: adminUser.id, 
                email: adminUser.email, 
                role: 'admin' 
            }, JWT_SECRET, { expiresIn: '24h' });
            
            return res.json({
                message: 'Admin login successful',
                token,
                user: { 
                    id: adminUser.id, 
                    email: adminUser.email, 
                    role: 'admin', 
                    name: adminUser.name 
                }
            });
        }
        
        // Regular user login
        let user;
        if (isEmail) {
            user = db.users.find(u => u.email === email);
        } else {
            // Check if username field exists, otherwise try to match with name
            user = db.users.find(u => u.name && u.name.toLowerCase().replace(/\s+/g, '_') === email.toLowerCase());
        }
        
        if (!user) {
            return res.status(400).json({ error: 'Invalid email/username or password' });
        }
        
        // Check if user is active
        if (user.isActive === false) {
            return res.status(403).json({ error: 'Your account has been restricted. Please contact admin.' });
        }
        
        // Check if user is verified
        if (user.isVerified === false) {
            return res.status(403).json({ error: 'Please verify your email before logging in. Check your email for the verification code.', requiresVerification: true, email: user.email });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email/username or password' });
        }
        
        // Generate token
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, email: user.email, role: user.role, name: user.name }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error logging in: ' + error.message });
    }
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// ==================== PASSWORD RESET ROUTES ====================

// Request password reset
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        // Find user by email
        const user = db.users.find(u => u.email === email);
        
        // Always return success to prevent email enumeration
        if (user) {
            // Generate reset token
            const resetToken = generateResetToken();
            const expiresAt = storeResetToken(email, resetToken);
            
            // Create reset link
            const resetLink = `${CLIENT_URL}/reset-password.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
            
            // Send email (simulated)
            const emailBody = `
Hello ${user.name || 'User'},

You requested a password reset for your Job Portal account.

Click the link below to reset your password:
${resetLink}

This link will expire in 24 hours.

If you didn't request this, please ignore this email.

Best regards,
Job Portal Team
            `;
            
            sendEmail(email, 'Password Reset - Job Portal', emailBody);
        }
        
        // Always return success
        res.json({
            message: 'If an account exists with this email, a password reset link has been sent'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error processing request: ' + error.message });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, email, password } = req.body;
        
        if (!token || !email || !password) {
            return res.status(400).json({ error: 'Token, email, and new password are required' });
        }
        
        // Validate password strength
        const passwordRequirements = {
            length: password.length >= 8,
            upper: /[A-Z]/.test(password),
            lower: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password)
        };
        
        if (!passwordRequirements.length || !passwordRequirements.upper || 
            !passwordRequirements.lower || !passwordRequirements.number || !passwordRequirements.special) {
            return res.status(400).json({ 
                error: 'Password does not meet requirements. It must be at least 8 characters with uppercase, lowercase, number, and special character.' 
            });
        }
        
        // Validate reset token
        if (!validateResetToken(email, token)) {
            return res.status(400).json({ error: 'Invalid or expired reset token. Please request a new password reset.' });
        }
        
        // Find user
        const user = db.users.find(u => u.email === email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Hash new password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Update user password
        user.password = hashedPassword;
        
        // Invalidate all existing tokens for this user (force re-login)
        // In production, you would maintain a token blacklist here
        
        res.json({
            message: 'Password reset successful. Please login with your new password.'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error resetting password: ' + error.message });
    }
});

// Verify reset token (for frontend to check validity before showing form)
app.get('/api/auth/verify-reset-token', (req, res) => {
    const { token, email } = req.query;
    
    if (!token || !email) {
        return res.status(400).json({ valid: false, error: 'Token and email are required' });
    }
    
    const resetData = passwordResetTokens.get(email);
    
    if (!resetData) {
        return res.json({ valid: false, error: 'Reset token not found or already used' });
    }
    
    if (Date.now() > resetData.expiresAt) {
        passwordResetTokens.delete(email);
        return res.json({ valid: false, error: 'Reset token has expired' });
    }
    
    if (resetData.token !== token) {
        return res.json({ valid: false, error: 'Invalid reset token' });
    }
    
    res.json({ valid: true });
});

// ==================== ADMIN MANAGEMENT ROUTES ====================

// Admin middleware
const adminAuthenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. Admin authentication required.' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token.' });
    }
};

// Get all employees (admin only)
app.get('/api/admin/employees', adminAuthenticateToken, (req, res) => {
    try {
        const employees = db.users
            .filter(u => u.role === 'employee' || u.role === 'employer')
            .map(u => {
                const { password, ...userWithoutPassword } = u;
                return userWithoutPassword;
            });
        
        res.json(employees);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching employees: ' + error.message });
    }
});

// Get employee details (admin only)
app.get('/api/admin/employees/:id', adminAuthenticateToken, (req, res) => {
    try {
        const user = db.users.find(u => u.id === req.params.id);
        
        if (!user) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        const { password, ...userWithoutPassword } = user;
        
        // Get employee applications
        const applications = db.applications.filter(a => a.employeeId === user.id);
        
        res.json({
            ...userWithoutPassword,
            applications
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching employee details: ' + error.message });
    }
});

// Add new employee (admin only)
app.post('/api/admin/employees', adminAuthenticateToken, async (req, res) => {
    try {
        const { name, email, password, role, designation } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        
        // Check if user already exists
        if (db.users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = {
            id: uuidv4(),
            email,
            password: hashedPassword,
            role: role || 'employee',
            designation: designation || null,
            name,
            createdAt: new Date().toISOString(),
            profile: null,
            isActive: true,
            status: 'active',
            addedBy: req.user.id,
            addedAt: new Date().toISOString()
        };
        
        db.users.push(user);
        
        const { password: pwd, ...userWithoutPassword } = user;
        
        res.status(201).json({
            message: 'Employee added successfully',
            user: userWithoutPassword
        });
    } catch (error) {
        res.status(500).json({ error: 'Error adding employee: ' + error.message });
    }
});

// Restrict/Deactivate employee (admin only)
app.put('/api/admin/employees/:id/restrict', adminAuthenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.params.id);
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        // Cannot restrict admin
        if (db.users[userIndex].role === 'admin') {
            return res.status(403).json({ error: 'Cannot restrict admin user' });
        }
        
        const { restrictReason } = req.body;
        
        db.users[userIndex].isActive = false;
        db.users[userIndex].status = 'restricted';
        db.users[userIndex].restrictedAt = new Date().toISOString();
        db.users[userIndex].restrictedBy = req.user.id;
        db.users[userIndex].restrictReason = restrictReason || 'No reason provided';
        
        res.json({
            message: 'Employee has been restricted',
            user: { id: db.users[userIndex].id, name: db.users[userIndex].name, status: 'restricted' }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error restricting employee: ' + error.message });
    }
});

// Activate employee (admin only)
app.put('/api/admin/employees/:id/activate', adminAuthenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.params.id);
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        db.users[userIndex].isActive = true;
        db.users[userIndex].status = 'active';
        db.users[userIndex].activatedAt = new Date().toISOString();
        db.users[userIndex].activatedBy = req.user.id;
        
        res.json({
            message: 'Employee has been activated',
            user: { id: db.users[userIndex].id, name: db.users[userIndex].name, status: 'active' }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error activating employee: ' + error.message });
    }
});

// Remove employee (admin only)
app.delete('/api/admin/employees/:id', adminAuthenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.params.id);
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        // Cannot remove admin
        if (db.users[userIndex].role === 'admin') {
            return res.status(403).json({ error: 'Cannot remove admin user' });
        }
        
        const userName = db.users[userIndex].name;
        
        // Remove user
        db.users.splice(userIndex, 1);
        
        res.json({ message: `Employee ${userName} has been removed` });
    } catch (error) {
        res.status(500).json({ error: 'Error removing employee: ' + error.message });
    }
});

// ==================== USER PROFILE ROUTES ====================

// Update employee profile
app.put('/api/profile', authenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const { phone, address, skills, experience, education, bio, desiredJobTitle, cnic, workHistory, testAttempts, testPassed, testScore, lastTestDate, profileScore } = req.body;
        
        // Merge with existing profile data
        const existingProfile = db.users[userIndex].profile || {};
        
        db.users[userIndex].profile = {
            ...existingProfile,
            phone,
            address,
            cnic,
            skills: skills ? (Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim())) : [],
            experience,
            education,
            bio,
            desiredJobTitle,
            workHistory: workHistory || existingProfile.workHistory || [],
            testAttempts: testAttempts || existingProfile.testAttempts || [],
            testPassed: testPassed !== undefined ? testPassed : existingProfile.testPassed,
            testScore: testScore !== undefined ? testScore : existingProfile.testScore,
            lastTestDate: lastTestDate || existingProfile.lastTestDate,
            profileScore: profileScore !== undefined ? profileScore : existingProfile.profileScore,
            updatedAt: new Date().toISOString()
        };
        
        res.json({ message: 'Profile updated successfully', profile: db.users[userIndex].profile });
    } catch (error) {
        res.status(500).json({ error: 'Error updating profile: ' + error.message });
    }
});

// Update management profile (for heads and CEOs)
app.put('/api/profile/management', authenticateToken, (req, res) => {
    try {
        // Check if user is management role
        if (req.user.role !== 'management' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only management users can update management profile' });
        }
        
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const {
            // Personal Info
            name, dob, phone, cnic, address, photo,
            // Company Info
            companyName, companyRegNumber, companyPhone, companyEmail, companyAddress, industry, companyWebsite,
            // Position Details
            positionTitle, managementLevel, department, yearsInPosition, teamSize, reportsTo, budgetResponsibility, branchCount,
            // Documents
            companyDoc, idCard, appointmentLetter,
            // Additional
            bio, achievements
        } = req.body;
        
        // Initialize profile if not exists
        if (!db.users[userIndex].profile) {
            db.users[userIndex].profile = {};
        }
        
        // Merge with existing profile data
        const existingProfile = db.users[userIndex].profile;
        const existingManagementProfile = existingProfile.managementProfile || {};
        
        // Update user name if provided
        if (name) {
            db.users[userIndex].name = name;
        }
        
        // Create/update management profile
        db.users[userIndex].profile = {
            ...existingProfile,
            // Basic profile fields
            phone: phone || existingProfile.phone,
            cnic: cnic || existingProfile.cnic,
            address: address || existingProfile.address,
            photo: photo || existingProfile.photo,
            bio: bio || existingProfile.bio,
            // Management specific fields
            managementProfile: {
                ...existingManagementProfile,
                // Personal
                dob,
                // Company
                companyName,
                companyRegNumber,
                companyPhone,
                companyEmail,
                companyAddress,
                industry,
                companyWebsite,
                // Position
                positionTitle,
                managementLevel,
                department,
                yearsInPosition,
                teamSize,
                reportsTo,
                budgetResponsibility,
                branchCount,
                // Documents
                companyDoc,
                idCard,
                appointmentLetter,
                // Additional
                bio: achievements ? `${bio || ''}\n\nKey Achievements:\n${achievements}` : bio,
                achievements,
                // Metadata
                isManagementProfile: true,
                profileCompletedAt: new Date().toISOString()
            },
            // Update main profile timestamp
            updatedAt: new Date().toISOString()
        };
        
        res.json({ 
            message: 'Management profile updated successfully', 
            profile: db.users[userIndex].profile,
            managementProfile: db.users[userIndex].profile.managementProfile
        });
    } catch (error) {
        res.status(500).json({ error: 'Error updating management profile: ' + error.message });
    }
});

// Upload CV
app.post('/api/profile/cv', authenticateToken, upload.single('cv'), (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Delete old CV if exists
        if (db.users[userIndex].profile && db.users[userIndex].profile.cv) {
            const oldCvPath = path.join(uploadsDir, path.basename(db.users[userIndex].profile.cv));
            if (fs.existsSync(oldCvPath)) {
                fs.unlinkSync(oldCvPath);
            }
        }
        
        if (!db.users[userIndex].profile) {
            db.users[userIndex].profile = {};
        }
        
        db.users[userIndex].profile.cv = `/uploads/${req.file.filename}`;
        db.users[userIndex].profile.cvUploadedAt = new Date().toISOString();
        
        res.json({ 
            message: 'CV uploaded successfully', 
            cv: db.users[userIndex].profile.cv 
        });
    } catch (error) {
        res.status(500).json({ error: 'Error uploading CV: ' + error.message });
    }
});

// Get user profile (public for employers)
app.get('/api/users/:id', authenticateToken, (req, res) => {
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// ==================== JOB ROUTES ====================

// Create job posting (Employer)
app.post('/api/jobs', authenticateToken, (req, res) => {
    try {
        if (req.user.role !== 'employer') {
            return res.status(403).json({ error: 'Only employers can post jobs' });
        }

        const { title, description, requirements, location, salary, jobType, category } = req.body;

        const employer = db.users.find(u => u.id === req.user.id);

        const job = {
            id: uuidv4(),
            employerId: req.user.id,
            employerName: employer?.name || 'Unknown',
            employerEmail: employer?.email || '',
            title,
            description,
            requirements: requirements ? (Array.isArray(requirements) ? requirements : requirements.split(',').map(r => r.trim())) : [],
            location,
            salary,
            jobType: jobType || 'full-time',
            category,
            status: 'active',
            createdAt: new Date().toISOString(),
            applications: []
        };

        db.jobs.push(job);

        // Send email notification to employer
        sendEmail(employer?.email || '', emailTemplates.jobPosted(job).subject, emailTemplates.jobPosted(job).body);

        res.status(201).json({ message: 'Job posted successfully', job });
    } catch (error) {
        res.status(500).json({ error: 'Error posting job: ' + error.message });
    }
});

// Get all jobs (with filters)
app.get('/api/jobs', authenticateToken, (req, res) => {
    try {
        let jobs = [...db.jobs];
        
        // Filter by status
        if (req.query.status === 'active') {
            jobs = jobs.filter(j => j.status === 'active');
        }
        
        // Filter by category
        if (req.query.category) {
            jobs = jobs.filter(j => j.category === req.query.category);
        }
        
        // Search by title
        if (req.query.search) {
            const searchLower = req.query.search.toLowerCase();
            jobs = jobs.filter(j => 
                j.title.toLowerCase().includes(searchLower) ||
                j.description.toLowerCase().includes(searchLower)
            );
        }
        
        // Sort by date
        jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching jobs: ' + error.message });
    }
});

// Get single job
app.get('/api/jobs/:id', authenticateToken, (req, res) => {
    const job = db.jobs.find(j => j.id === req.params.id);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
});

// Update job
app.put('/api/jobs/:id', authenticateToken, (req, res) => {
    try {
        const jobIndex = db.jobs.findIndex(j => j.id === req.params.id);
        if (jobIndex === -1) {
            return res.status(404).json({ error: 'Job not found' });
        }
        
        if (db.jobs[jobIndex].employerId !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to update this job' });
        }
        
        const { title, description, requirements, location, salary, jobType, category, status } = req.body;
        
        db.jobs[jobIndex] = {
            ...db.jobs[jobIndex],
            title: title || db.jobs[jobIndex].title,
            description: description || db.jobs[jobIndex].description,
            requirements: requirements || db.jobs[jobIndex].requirements,
            location: location || db.jobs[jobIndex].location,
            salary: salary || db.jobs[jobIndex].salary,
            jobType: jobType || db.jobs[jobIndex].jobType,
            category: category || db.jobs[jobIndex].category,
            status: status || db.jobs[jobIndex].status,
            updatedAt: new Date().toISOString()
        };
        
        res.json({ message: 'Job updated successfully', job: db.jobs[jobIndex] });
    } catch (error) {
        res.status(500).json({ error: 'Error updating job: ' + error.message });
    }
});

// Delete job
app.delete('/api/jobs/:id', authenticateToken, (req, res) => {
    const jobIndex = db.jobs.findIndex(j => j.id === req.params.id);
    if (jobIndex === -1) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    if (db.jobs[jobIndex].employerId !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to delete this job' });
    }
    
    db.jobs.splice(jobIndex, 1);
    res.json({ message: 'Job deleted successfully' });
});

// ==================== APPLICATION ROUTES ====================

// Apply for job (Employee)
app.post('/api/jobs/:id/apply', authenticateToken, (req, res) => {
    try {
        if (req.user.role !== 'employee') {
            return res.status(403).json({ error: 'Only employees can apply for jobs' });
        }

        const job = db.jobs.find(j => j.id === req.params.id);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        // Check if already applied
        const existingApplication = db.applications.find(
            a => a.jobId === req.params.id && a.employeeId === req.user.id
        );
        if (existingApplication) {
            return res.status(400).json({ error: 'You have already applied for this job' });
        }

        const user = db.users.find(u => u.id === req.user.id);
        if (!user.profile || !user.profile.cv) {
            return res.status(400).json({ error: 'Please upload your CV before applying' });
        }

        const application = {
            id: uuidv4(),
            jobId: req.params.id,
            employeeId: req.user.id,
            employeeName: user.name,
            employeeEmail: user.email,
            employeeProfile: user.profile,
            status: 'pending',
            progress: 0, // 0-100
            appliedAt: new Date().toISOString(),
            notes: ''
        };

        db.applications.push(application);

        // Send email notification to candidate
        sendEmail(user.email, emailTemplates.applicationReceived(job, user).subject, emailTemplates.applicationReceived(job, user).body);

        // Send email notification to employer
        const employer = db.users.find(u => u.id === job.employerId);
        if (employer) {
            sendEmail(employer.email, emailTemplates.newApplication(job, application).subject, emailTemplates.newApplication(job, application).body);
        }

        res.status(201).json({ message: 'Application submitted successfully', application });
    } catch (error) {
        res.status(500).json({ error: 'Error applying for job: ' + error.message });
    }
});

// Get employee applications
app.get('/api/applications', authenticateToken, (req, res) => {
    try {
        let applications;
        
        if (req.user.role === 'employee') {
            applications = db.applications.filter(a => a.employeeId === req.user.id);
        } else if (req.user.role === 'employer') {
            applications = db.applications.filter(a => {
                const job = db.jobs.find(j => j.id === a.jobId);
                return job && job.employerId === req.user.id;
            });
        } else {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Add job details to applications
        applications = applications.map(a => {
            const job = db.jobs.find(j => j.id === a.jobId);
            return { ...a, job };
        });
        
        res.json(applications);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching applications: ' + error.message });
    }
});

// Update application status/progress (Employer)
app.put('/api/applications/:id', authenticateToken, (req, res) => {
    try {
        const appIndex = db.applications.findIndex(a => a.id === req.params.id);
        if (appIndex === -1) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Check if employer owns the job
        const job = db.jobs.find(j => j.id === db.applications[appIndex].jobId);
        if (!job || job.employerId !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to update this application' });
        }

        const { status, progress, notes } = req.body;

        // Send email notification if status changed
        if (status && status !== db.applications[appIndex].status) {
            const application = db.applications[appIndex];
            const candidateEmail = application.employeeEmail;
            sendEmail(candidateEmail, emailTemplates.applicationUpdate(application, job, status).subject, emailTemplates.applicationUpdate(application, job, status).body);
        }

        db.applications[appIndex].status = status || db.applications[appIndex].status;
        db.applications[appIndex].progress = progress !== undefined ? progress : db.applications[appIndex].progress;
        db.applications[appIndex].notes = notes !== undefined ? notes : db.applications[appIndex].notes;
        db.applications[appIndex].updatedAt = new Date().toISOString();

        res.json({ message: 'Application updated successfully', application: db.applications[appIndex] });
    } catch (error) {
        res.status(500).json({ error: 'Error updating application: ' + error.message });
    }
});

// ==================== EMPLOYEE PROGRESS ROUTES ====================

// Get employee progress (for employees viewing their own progress)
app.get('/api/progress', authenticateToken, (req, res) => {
    try {
        if (req.user.role !== 'employee') {
            return res.status(403).json({ error: 'Only employees can view their progress' });
        }
        
        const applications = db.applications.filter(a => a.employeeId === req.user.id);
        
        const progress = {
            totalApplications: applications.length,
            pendingApplications: applications.filter(a => a.status === 'pending').length,
            inProgressApplications: applications.filter(a => a.status === 'interview' || a.status === 'screening').length,
            acceptedApplications: applications.filter(a => a.status === 'accepted').length,
            rejectedApplications: applications.filter(a => a.status === 'rejected').length,
            averageProgress: applications.length > 0 
                ? Math.round(applications.reduce((sum, a) => sum + a.progress, 0) / applications.length) 
                : 0,
            applications: applications.map(a => {
                const job = db.jobs.find(j => j.id === a.jobId);
                return { ...a, job };
            })
        };
        
        res.json(progress);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching progress: ' + error.message });
    }
});

// ==================== SEARCH EMPLOYEES (Employer) ====================

app.get('/api/employees', authenticateToken, (req, res) => {
    try {
        if (req.user.role !== 'employer') {
            return res.status(403).json({ error: 'Only employers can search employees' });
        }
        
        let employees = db.users
            .filter(u => u.role === 'employee')
            .map(u => {
                const { password, ...userWithoutPassword } = u;
                // Count applications
                const applicationCount = db.applications.filter(a => a.employeeId === u.id).length;
                return { ...userWithoutPassword, applicationCount };
            });
        
        // Filter by skills
        if (req.query.skills) {
            const skills = req.query.skills.toLowerCase().split(',').map(s => s.trim());
            employees = employees.filter(e => 
                e.profile && e.profile.skills && 
                e.profile.skills.some(s => skills.some(skill => s.toLowerCase().includes(skill)))
            );
        }
        
        res.json(employees);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching employees: ' + error.message });
    }
});

// ==================== ONBOARDING ROUTES ====================

// Update user type (employee, employer, student)
app.put('/api/onboarding/user-type', authenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const { userType } = req.body;
        db.users[userIndex].userType = userType;
        db.users[userIndex].onboardingStep = userType === 'employer' ? 'complete' : 'qualifications';
        
        res.json({ 
            message: 'User type updated', 
            userType,
            onboardingStep: db.users[userIndex].onboardingStep
        });
    } catch (error) {
        res.status(500).json({ error: 'Error updating user type: ' + error.message });
    }
});

// Save qualifications
app.put('/api/onboarding/qualifications', authenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const { highestEducation, fieldOfStudy, institution, graduationYear, certifications } = req.body;
        
        db.users[userIndex].qualifications = {
            highestEducation,
            fieldOfStudy,
            institution,
            graduationYear,
            certifications: certifications || [],
            completedAt: new Date().toISOString()
        };
        
        db.users[userIndex].onboardingStep = 'experience';
        
        res.json({ 
            message: 'Qualifications saved',
            onboardingStep: 'experience'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error saving qualifications: ' + error.message });
    }
});

// Save experience
app.put('/api/onboarding/experience', authenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const { hasExperience, experienceLevel, currentJobTitle, currentCompany, yearsOfExperience, workHistory } = req.body;
        
        db.users[userIndex].experience = {
            hasExperience,
            experienceLevel,
            currentJobTitle,
            currentCompany,
            yearsOfExperience: hasExperience ? yearsOfExperience : 0,
            workHistory: workHistory || [],
            completedAt: new Date().toISOString()
        };
        
        db.users[userIndex].onboardingStep = 'skills';
        
        res.json({ 
            message: 'Experience saved',
            onboardingStep: 'skills'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error saving experience: ' + error.message });
    }
});

// Save skills
app.put('/api/onboarding/skills', authenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const { skills, skillLevel, interestedFields } = req.body;
        
        if (!db.users[userIndex].profile) {
            db.users[userIndex].profile = {};
        }
        
        db.users[userIndex].profile.skills = skills || [];
        db.users[userIndex].profile.skillLevel = skillLevel;
        db.users[userIndex].profile.interestedFields = interestedFields || [];
        db.users[userIndex].onboardingStep = 'assessment';
        
        res.json({ 
            message: 'Skills saved',
            onboardingStep: 'assessment'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error saving skills: ' + error.message });
    }
});

// Get assessment questions based on interested field
app.get('/api/assessment/questions', authenticateToken, (req, res) => {
    try {
        const user = db.users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const field = user.profile?.interestedFields?.[0] || 'IT';
        const questions = skillsQuestions[field] || skillsQuestions['IT'];
        
        // Return 10 random questions
        const shuffled = questions.sort(() => 0.5 - Math.random()).slice(0, 10);
        
        // Don't send correct answers
        const questionsWithoutAnswers = shuffled.map(({ answer, ...q }) => q);
        
        res.json({
            field,
            questions: questionsWithoutAnswers,
            totalQuestions: questionsWithoutAnswers.length
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching questions: ' + error.message });
    }
});

// Submit assessment answers
app.post('/api/assessment/submit', authenticateToken, (req, res) => {
    try {
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const { answers, field } = req.body;
        const questions = skillsQuestions[field] || skillsQuestions['IT'];
        
        // Calculate score
        let correctCount = 0;
        const results = answers.map((answer, index) => {
            const question = questions[index];
            const isCorrect = question && answer === question.answer;
            if (isCorrect) correctCount++;
            return {
                questionId: question ? question.id : index,
                selectedAnswer: answer,
                correctAnswer: question ? question.answer : null,
                isCorrect
            };
        });
        
        const totalQuestions = answers.length;
        const score = Math.round((correctCount / totalQuestions) * 100);
        
        // Determine skill level based on score
        let skillLevel = 'Beginner';
        if (score >= 90) skillLevel = 'Expert';
        else if (score >= 70) skillLevel = 'Advanced';
        else if (score >= 50) skillLevel = 'Intermediate';
        
        // Save assessment results
        db.users[userIndex].assessment = {
            field,
            score,
            correctAnswers: correctCount,
            totalQuestions,
            skillLevel,
            results,
            completedAt: new Date().toISOString()
        };
        
        db.users[userIndex].onboardingStep = 'complete';
        
        res.json({
            message: 'Assessment completed',
            score,
            correctAnswers: correctCount,
            totalQuestions,
            skillLevel
        });
    } catch (error) {
        res.status(500).json({ error: 'Error submitting assessment: ' + error.message });
    }
});

// Get onboarding status
app.get('/api/onboarding/status', authenticateToken, (req, res) => {
    try {
        const user = db.users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            userType: user.userType,
            onboardingStep: user.onboardingStep || (user.role === 'employer' ? 'complete' : 'userType'),
            profile: user.profile,
            qualifications: user.qualifications,
            experience: user.experience,
            assessment: user.assessment
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching onboarding status: ' + error.message });
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Job Portal server running on http://jobseeker.edu.pk:${PORT}`);
    console.log(`Or access locally at http://localhost:${PORT}`);
});
