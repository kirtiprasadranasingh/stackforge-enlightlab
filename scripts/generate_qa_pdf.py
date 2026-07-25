import os
import shutil
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable

pdf_path = r'd:\stackforge-Enligthlab\StackForge_QA_Error_Analysis_and_Fix_Report.pdf'
downloads_pdf_path = r'C:\Users\KIRTI\Downloads\StackForge_QA_Error_Analysis_and_Fix_Report.pdf'

doc = SimpleDocTemplate(
    pdf_path,
    pagesize=letter,
    rightMargin=36,
    leftMargin=36,
    topMargin=36,
    bottomMargin=36
)

styles = getSampleStyleSheet()

# Custom styles
title_style = ParagraphStyle(
    'DocTitle',
    parent=styles['Heading1'],
    fontName='Helvetica-Bold',
    fontSize=20,
    leading=24,
    textColor=colors.HexColor('#1E1B4B'),
    alignment=0,
    spaceAfter=4
)

subtitle_style = ParagraphStyle(
    'DocSubTitle',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=10,
    leading=14,
    textColor=colors.HexColor('#4338CA'),
    spaceAfter=12
)

card_title = ParagraphStyle(
    'CardTitle',
    parent=styles['Heading3'],
    fontName='Helvetica-Bold',
    fontSize=10,
    leading=13,
    textColor=colors.HexColor('#0F172A')
)

label_style = ParagraphStyle(
    'LabelStyle',
    parent=styles['Normal'],
    fontName='Helvetica-Bold',
    fontSize=8.5,
    leading=11,
    textColor=colors.HexColor('#334155')
)

body_style = ParagraphStyle(
    'BodyStyle',
    parent=styles['Normal'],
    fontName='Helvetica',
    fontSize=8.5,
    leading=12,
    textColor=colors.HexColor('#1E293B')
)

story = []

# Title Banner
story.append(Paragraph('StackForge QA Error Analysis & Fix Verification Guide', title_style))
story.append(Paragraph('Comprehensive Row-by-Row Analysis, Layman Explanations, Requirement Selections & Verification Results', subtitle_style))
story.append(HRFlowable(width='100%', thickness=1.5, color=colors.HexColor('#4F46E5'), spaceAfter=12))

# Introduction Paragraph
intro_text = '''
This document provides a complete QA reference for all <b>15 failed test scenarios</b> identified in <code>Stackforge.xlsx</code>. 
For every failed test prompt, this report details: (1) what went wrong in plain layman terms, (2) the exact interview option selections to test in StackForge, and (3) the expected correct result required to confirm that the bug is officially fixed.
'''
story.append(Paragraph(intro_text, body_style))
story.append(Spacer(1, 10))

# 15 Test Cases Data
test_cases = [
    {
        'row': 'Row 5',
        'prompt': 'Deploy my app',
        'category': 'Interview Flow / Vague Prompt',
        'severity': 'High',
        'wrong': 'StackForge panicked on a short 3-word prompt and skipped the interview completely. It immediately generated AWS EKS code with assumed settings without asking clarifying questions or presenting a plan for approval.',
        'options': '• Cloud Provider: AWS<br/>• Hosting Platform: Amazon EKS<br/>• Region: us-east-1<br/>• CI/CD System: GitHub Actions<br/>• Database: No data service<br/>• Runtime: Node.js',
        'expected': 'StackForge MUST NOT generate code right away. It must enter Interview Mode, ask clarifying questions (Cloud, Hosting, CI/CD, Region), present a draft plan for user approval, and only generate files after approval.'
    },
    {
        'row': 'Row 6',
        'prompt': 'Production API.',
        'category': 'UI Dropdown Loop',
        'severity': 'Medium',
        'wrong': 'Clicking "Another service" in the interview options dropdown re-opened the exact same option buttons in a loop instead of displaying a text input box.',
        'options': '• On Database/Cache Question: Click "Another service"<br/>• Type custom service name: "MongoDB"',
        'expected': 'Clicking "Another service" opens a clean text box allowing you to type custom database/cache names (e.g., MongoDB) and advance smoothly.'
    },
    {
        'row': 'Row 7',
        'prompt': 'Invalid Inputs (efewwe / wewer)',
        'category': 'Input Validation',
        'severity': 'High',
        'wrong': 'Typing random text like "efewwe" for database or "wewer" for language was accepted without validation. StackForge fabricated fake technical reasons and secretly defaulted to PostgreSQL/Node.js.',
        'options': '• Database input text box: Type "efewwe"<br/>• Language input text box: Type "wewer"',
        'expected': 'StackForge validates inputs. It politely flags invalid inputs and asks the user to choose a valid supported option (Node.js, Python, Go, PostgreSQL, MySQL, Redis) before proceeding.'
    },
    {
        'row': 'Row 9',
        'prompt': 'Cloud infrastructure.',
        'category': 'Database Missing Support',
        'severity': 'High',
        'wrong': 'Selecting MongoDB as the database in the interview caused StackForge to ignore it or generate PostgreSQL Terraform code instead.',
        'options': '• Cloud Provider: AWS<br/>• Data Service: Select "Another service" and type "MongoDB"',
        'expected': 'Generated architecture plan and Terraform files explicitly include MongoDB / DocumentDB resources and contain zero PostgreSQL declarations.'
    },
    {
        'row': 'Row 12',
        'prompt': 'Deploy my backend.',
        'category': 'Interview Flow',
        'severity': 'Medium',
        'wrong': 'Asking to deploy a backend without specific parameters caused StackForge to fail to establish a structured interview flow.',
        'options': '• Cloud Provider: Google Cloud<br/>• Hosting Platform: Google Cloud Run<br/>• CI/CD System: GitLab CI<br/>• Runtime: Python',
        'expected': 'StackForge enters Interview Mode, prompts for the missing parameters above, and generates a clean Google Cloud Run scaffold.'
    },
    {
        'row': 'Row 14',
        'prompt': 'I need scalable infrastructure.',
        'category': 'Cross-Cloud Template Leakage',
        'severity': 'High',
        'wrong': 'When OCI DevOps (Oracle Cloud) was selected for CI/CD, StackForge generated code containing AWS resources (EKS, ECR, S3), mixing two different cloud providers together.',
        'options': '• Cloud Provider: Oracle Cloud Infrastructure<br/>• Hosting Platform: Oracle Kubernetes Engine (OKE)<br/>• Region: ap-mumbai-1<br/>• CI/CD System: OCI DevOps<br/>• Database: MySQL',
        'expected': 'Generated Terraform and build specs contain 100% Oracle Cloud (OCI) resources (oci_core_vcn, oci_containerengine_cluster) and zero AWS references.'
    },
    {
        'row': 'Row 15',
        'prompt': 'Create DevOps for my startup.',
        'category': 'Cross-Cloud IAM Conflict',
        'severity': 'High',
        'wrong': 'Choosing Google Cloud Build for CI/CD and AWS for hosting resulted in broken IAM claims that Cloud Build directly manages AWS EKS/ECR without proper cross-cloud OIDC configuration.',
        'options': '• Cloud Provider: AWS<br/>• Hosting Platform: Amazon EKS<br/>• CI/CD System: Google Cloud Build',
        'expected': 'IAM & Secrets section correctly uses AWS OIDC role authentication for GCP Cloud Build, without invalid direct cross-cloud permission claims.'
    },
    {
        'row': 'Row 16',
        'prompt': 'Deploy on AWS ECS.',
        'category': 'Health Stub Overwrite',
        'severity': 'Medium',
        'wrong': 'Selecting Java for the minimal /health stub caused StackForge to convert the entire main application into a Java Spring Boot architecture.',
        'options': '• Cloud Provider: AWS<br/>• Hosting Platform: Amazon ECS (Fargate)<br/>• Health Stub Language: Java',
        'expected': 'Main application spec remains generic/user-defined, and Java is ONLY used for the lightweight /health check stub.'
    },
    {
        'row': 'Row 17',
        'prompt': 'Cloud Switching Prompts',
        'category': 'Cloud Switching Residue',
        'severity': 'Medium',
        'wrong': 'Changing your mind during the interview from AWS ECS to Google Cloud Run left behind leftover AWS ECS task definitions and ALB terraform files in the Google Cloud output.',
        'options': '• Prompt: "Deploy on AWS ECS"<br/>• Question 1: Click "Change the cloud" -> Select "Google Cloud" & "Google Cloud Run"',
        'expected': 'Generated files contain 100% Google Cloud Run files. All AWS files are completely purged.'
    },
    {
        'row': 'Row 19',
        'prompt': 'Python FastAPI service',
        'category': 'Runtime Loss',
        'severity': 'High',
        'wrong': 'Picking Go for the health stub deleted all Node.js / FastAPI files (server.js, package.json) and replaced the app with main.go.',
        'options': '• Prompt: "Build a Node.js Express API on Azure Container Apps"<br/>• Health Stub Language: Select "Go"',
        'expected': 'Primary app code remains Node.js (server.js, package.json). Go is ONLY used for the minimal /health stub.'
    },
    {
        'row': 'Row 21',
        'prompt': 'Java Spring Boot service',
        'category': 'CI/CD & Registry Mismatch',
        'severity': 'High',
        'wrong': 'Terraform created AWS ECR, but the OCI DevOps build script was configured to push Docker images to Oracle Registry (OCIR), causing build crashes.',
        'options': '• Cloud Provider: AWS<br/>• Hosting Platform: Amazon EKS<br/>• CI/CD System: OCI DevOps',
        'expected': 'Both Terraform and OCI DevOps pipeline use the exact same registry (AWS ECR or OCIR consistently).'
    },
    {
        'row': 'Row 22',
        'prompt': '.NET API',
        'category': 'Greeting / Loop Bug',
        'severity': 'Medium',
        'wrong': 'Typing ".NET API" and replying "yes please" caused StackForge to restart its welcome intro message from scratch.',
        'options': '• Prompt: ".NET API"<br/>• Follow-up: Type "yes please"',
        'expected': 'StackForge immediately enters Interview Mode for .NET rather than repeating the welcome intro message.'
    },
    {
        'row': 'Row 23',
        'prompt': 'Use PostgreSQL.',
        'category': 'Database Mismatch',
        'severity': 'High',
        'wrong': 'Selecting 1 environment and RDS PostgreSQL caused StackForge to generate Dev/Staging environments and Amazon Aurora (aws_rds_cluster).',
        'options': '• Environments: "One environment"<br/>• Database Mode: "Standard private database" (PostgreSQL)',
        'expected': 'Terraform provisions aws_db_instance (Standard RDS PostgreSQL), NOT aws_rds_cluster (Aurora), and generates only 1 environment tfvars file.'
    },
    {
        'row': 'Row 24',
        'prompt': 'Use MySQL.',
        'category': 'Template Leakage & Labels',
        'severity': 'High',
        'wrong': 'Selecting Azure DevOps caused StackForge to mention "GitHub Actions for AWS Auth" in assumptions, and "One environment" was renamed to "One environment (production-like)".',
        'options': '• CI/CD System: Azure DevOps Pipelines<br/>• Environments: "One environment"',
        'expected': 'Zero mentions of GitHub Actions. Environment selection states "One environment" without extra labels.'
    },
    {
        'row': 'Row 25',
        'prompt': 'Use Redis.',
        'category': 'Azure Template Leakage',
        'severity': 'High',
        'wrong': 'Building an Azure + Redis architecture resulted in AWS terms (RDS, ECS, Secrets Manager, ALB) and contradicted Public HTTPS choices.',
        'options': '• Cloud Provider: Microsoft Azure<br/>• Hosting Platform: Azure Container Apps<br/>• CI/CD System: Azure DevOps Pipelines<br/>• Access: Public with secure HTTPS<br/>• Data Service: Redis cache',
        'expected': '100% Azure resources (Azure Key Vault, Application Gateway, Azure Cache for Redis). Zero AWS terms.'
    }
]

for tc in test_cases:
    sev_color = '#DC2626' if tc['severity'] == 'High' else '#EA580C'
    
    card_data = [
        [
            Paragraph(f'<b>{tc["row"]}: {tc["prompt"]}</b> (Category: {tc["category"]})', card_title),
            Paragraph(f'<b>Severity:</b> <font color="{sev_color}">{tc["severity"]}</font>', ParagraphStyle('Sev', parent=label_style, alignment=2))
        ],
        [
            Paragraph('<b>What Was Wrong (Layman Terms):</b>', label_style),
            Paragraph(tc['wrong'], body_style)
        ],
        [
            Paragraph('<b>Interview Requirement Options to Select:</b>', label_style),
            Paragraph(tc['options'], body_style)
        ],
        [
            Paragraph('<b>Expected Correct Result (Fix Verification):</b>', label_style),
            Paragraph(tc['expected'], body_style)
        ]
    ]
    
    t = Table(card_data, colWidths=[150, 390])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
        ('SPAN', (0,0), (0,0)),
        ('LINEBELOW', (0,0), (-1,0), 1, colors.HexColor('#CBD5E1')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#CBD5E1')),
        ('BACKGROUND', (0,1), (0,-1), colors.HexColor('#F8FAFC')),
    ]))
    
    story.append(t)
    story.append(Spacer(1, 8))

doc.build(story)

# Copy to Downloads
shutil.copy(pdf_path, downloads_pdf_path)

print(f'PDF successfully generated at:\n  1. {pdf_path}\n  2. {downloads_pdf_path}')
