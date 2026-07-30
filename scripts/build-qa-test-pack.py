from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE

OUT = r"D:\stackforge-Enligthlab\StackForge_QA_Test_Pack.docx"

def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:fill'), fill)
    tc_pr.append(shd)

def set_cell_width(cell, inches):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn('w:tcW'))
    if tc_w is None:
        tc_w = OxmlElement('w:tcW')
        tc_pr.append(tc_w)
    tc_w.set(qn('w:w'), str(int(inches * 1440)))
    tc_w.set(qn('w:type'), 'dxa')

def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    el = OxmlElement('w:tblHeader')
    el.set(qn('w:val'), 'true')
    tr_pr.append(el)

def set_font(run, size=11, bold=False, color=None):
    run.font.name = 'Calibri'
    run._element.rPr.rFonts.set(qn('w:ascii'), 'Calibri')
    run._element.rPr.rFonts.set(qn('w:hAnsi'), 'Calibri')
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)

def add_text(doc, text, bold=False, color=None, size=11):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.12
    r = p.add_run(text)
    set_font(r, size=size, bold=bold, color=color)
    return p

def add_bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.1
        set_font(p.add_run(item), size=10.5)

def add_table(doc, rows, widths=(1.5, 5.0), header=True):
    table = doc.add_table(rows=0, cols=len(widths))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    for i, data in enumerate(rows):
        cells = table.add_row().cells
        for j, value in enumerate(data):
            set_cell_width(cells[j], widths[j])
            cells[j].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            p = cells[j].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            r = p.add_run(value)
            set_font(r, size=9.5, bold=(header and i == 0), color='FFFFFF' if header and i == 0 else None)
            if header and i == 0:
                set_cell_shading(cells[j], '1F4D78')
        if header and i == 0:
            set_repeat_table_header(table.rows[0])
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table

def add_case(doc, case):
    doc.add_heading(f"{case['id']} - {case['name']}", level=2)
    rows = [
        ('Client prompt', case['prompt']),
        ('Interview selections', case['options']),
        ('Expected plan', case['plan']),
        ('Expected scaffold', case['code']),
        ('Must not produce', case['negative']),
        ('Expected result', case['result']),
    ]
    add_table(doc, [('Check', 'Expected behavior')] + rows)

cases = [
 {'id':'SF-01','name':'AWS ECS public Redis high traffic','prompt':'Build production AWS ECS infrastructure with Node.js and Redis.','options':'us-east-1; development, staging, production; public HTTP default hostname; Redis HA; high traffic; GitHub Actions.','plan':'AWS ECS, Redis/ElastiCache, Node.js, GitHub Actions, all three environments, HTTP default-hostname limitation.','code':'terraform/ecs.tf, alb.tf, redis.tf; app/server.js; app/Dockerfile; environments for all selected envs; deploy.yml.','negative':'EKS, RDS/PostgreSQL, HTTPS certificate on provider hostname, another CI file.','result':'Plan approved; contract and offline scaffold checks pass.'},
 {'id':'SF-02','name':'AWS EKS private Java PostgreSQL','prompt':'Build production AWS EKS infrastructure with Java and PostgreSQL.','options':'us-west-2; production only; private/internal; PostgreSQL; medium traffic; GitHub Actions.','plan':'EKS, Java health stub, PostgreSQL, private delivery using ClusterIP and disabled ingress.','code':'terraform/eks.tf and database.tf; app/Java source + pom.xml + Dockerfile; production.tfvars; Helm chart.','negative':'ALB, ALB controller, IRSA claim, ingress, public endpoint, ECS files.','result':'Plan approved only if it does not promise ungenerated private-ingress resources.'},
 {'id':'SF-03','name':'AWS EKS public HTTPS intent','prompt':'Build production AWS EKS with Java and Redis.','options':'us-east-1; production only; public HTTPS/custom domain; Redis HA; high traffic.','plan':'Service LoadBalancer delivery plus explicit client follow-up for DNS, ACM/certificate and HTTPS ingress.','code':'EKS, Redis, Java, HPA and production tfvars; no DNS/certificate Terraform.','negative':'Route 53, ACM, ALB controller, Cluster Autoscaler or custom-domain code claims.','result':'Plan may be approved only with the HTTPS follow-up boundary.'},
 {'id':'SF-04','name':'GKE GitLab public PostgreSQL','prompt':'I need a secure web application infrastructure on Google Cloud.','options':'GKE; GitLab CI; us-central1; production only; public HTTP; PostgreSQL; Java.','plan':'GKE, Cloud SQL PostgreSQL, Artifact Registry, GitLab CI, public GCE ingress, Java.','code':'terraform/gke.tf, network.tf, iam.tf, main.tf; .gitlab-ci.yml; app Java files; chart ingress class gce.','negative':'GitHub workflow, nginx controller claim, artifact_registry.tf if main.tf owns registry.','result':'GitLab pipeline contains docker build/push and helm upgrade commands; no placeholder echo deployment.'},
 {'id':'SF-05','name':'GKE Redis private HA','prompt':'I need a private Google Kubernetes Engine application with Redis.','options':'asia-south1; development only; private/internal; Redis HA; Python; GitHub Actions.','plan':'GKE, private Memorystore Redis, Python, private access.','code':'google_redis_instance in terraform/main.tf; private service networking; redis_host output; development.tfvars enable_redis=true and redis_ha=true.','negative':'Unsupported-combination block, PostgreSQL resource, public ingress.','result':'Plan and code generate successfully; Redis contract passes.'},
 {'id':'SF-06','name':'Cloud Run private .NET PostgreSQL','prompt':'Create a private Google Cloud Run service using .NET and PostgreSQL.','options':'europe-west1; staging only; private/internal; PostgreSQL; GitHub Actions.','plan':'Cloud Run, private ingress, Cloud SQL PostgreSQL, .NET minimal health implementation.','code':'Root Dockerfile, Program.cs, app.csproj; cloudrun.tf, database.tf, staging.tfvars, deploy.yml.','negative':'app/Program.cs in file manifest, public invoker, full ASP.NET controller/service claims.','result':'Manifest exactly uses root .NET paths.'},
 {'id':'SF-07','name':'Azure Container Apps private Go PostgreSQL','prompt':'Build Azure Container Apps infrastructure for a Go API and PostgreSQL.','options':'westeurope; development and staging; private/internal; PostgreSQL; Azure DevOps.','plan':'Azure Container Apps, private ingress, PostgreSQL Flexible Server, Go, Azure DevOps.','code':'container_apps.tf, database.tf, key_vault.tf, identity.tf; Go root files; azure-pipelines.yml.','negative':'AWS resources, public ingress, GitHub Actions, wrong root/app paths.','result':'Plan/code contract passes; Terraform validate is eligible offline.'},
 {'id':'SF-08','name':'Azure AKS Redis HA','prompt':'Build Azure AKS infrastructure with Python and Redis.','options':'centralindia; production only; private/internal; Redis HA; Azure DevOps.','plan':'AKS, native Azure Redis, Python, private network, production.','code':'terraform/redis.tf, AKS files, Python stub, production.tfvars with Redis flags.','negative':'PostgreSQL output references, public access, AWS ElastiCache.','result':'Redis outputs and resources are consistent.'},
 {'id':'SF-09','name':'Oracle OKE MySQL','prompt':'Build Oracle OKE infrastructure with Go and MySQL.','options':'ap-mumbai-1; staging only; private/internal; MySQL; GitHub Actions.','plan':'OKE, MySQL, Go, selected region and staging only.','code':'OKE Terraform profile, MySQL database adapter, Go files, staging tfvars.','negative':'PostgreSQL claim, Azure/AWS resource leakage, extra environments.','result':'Supported profile generates a locked scaffold.'},
 {'id':'SF-10','name':'Cloud/platform override wins','prompt':'Generate AWS EKS stack with Python.','options':'Client override: Microsoft Azure; Azure Container Apps; westeurope; development/staging; MySQL; public HTTP.','plan':'Azure Container Apps and MySQL only.','code':'Azure Terraform and selected CI/runtime only.','negative':'AWS Secrets Manager, EKS, ECS, AWS region or GitHub workflow leakage.','result':'Latest explicit cloud/platform override replaces original prompt intent.'},
 {'id':'SF-11','name':'CI override wins','prompt':'Build an AWS EKS application.','options':'GitLab CI; us-east-1; staging only; private; PostgreSQL; Python.','plan':'GitLab CI only.','code':'.gitlab-ci.yml only; no deploy.yml.','negative':'GitHub Actions file or prose.','result':'Exactly one CI pipeline is emitted.'},
 {'id':'SF-12','name':'Latest region correction wins','prompt':'Build a GCP Cloud Run service.','options':'Initial region us-central1; correction: europe-west1; production only; private; no data; Go.','plan':'europe-west1 everywhere.','code':'production.tfvars and Terraform defaults use europe-west1.','negative':'us-central1 remaining in confirmed requirements or deployment config.','result':'Correction regenerates the plan with latest region.'},
 {'id':'SF-13','name':'Latest database correction wins','prompt':'Build AWS EKS service.','options':'Initial MongoDB; correction: PostgreSQL; us-east-1; staging; private; Python.','plan':'PostgreSQL only.','code':'database.tf and outputs for PostgreSQL; no MongoDB files.','negative':'MongoDB block message after correction, DocumentDB/Atlas files.','result':'Correction is applied before plan approval.'},
 {'id':'SF-14','name':'No data service removes data code','prompt':'Build AWS ECS health service.','options':'ap-south-1; development only; public HTTP; no data service; Node.js.','plan':'No data service.','code':'No database/redis Terraform resources or outputs.','negative':'RDS, MySQL, Redis, Cloud SQL, database secret claims.','result':'No-data contract and manifest pass.'},
 {'id':'SF-15','name':'Java language does not imply Spring Boot','prompt':'Build AWS EKS with Java.','options':'us-east-1; production only; private; no data service; Java.','plan':'Java language with minimal health stub; framework not confirmed.','code':'Plain Java health app and pom.xml as implementation default.','negative':'DemoApplication.java, Spring Boot, controllers, Maven Spring starter claims.','result':'Plan discloses minimal implementation without inventing framework.'},
 {'id':'SF-16','name':'.NET language does not imply controllers','prompt':'Build GKE .NET service.','options':'europe-west1; staging only; public HTTP; PostgreSQL; .NET.','plan':'.NET minimal health implementation only.','code':'Program.cs, app.csproj, Dockerfile.','negative':'ASP.NET controllers/services or full application architecture claims.','result':'Runtime and file layout are consistent.'},
 {'id':'SF-17','name':'One-environment selection','prompt':'Create AWS ECS API.','options':'Production only; us-east-1; private; Redis; Go.','plan':'Production only.','code':'Only environments/production.tfvars.','negative':'Development/staging files or plan claims.','result':'No extra environments are invented.'},
 {'id':'SF-18','name':'Invalid region handling','prompt':'Deploy a GCP GKE API.','options':'moon-central-1; Python; no data service.','plan':'No approval-ready plan.','code':'No scaffold generation.','negative':'Invented region or silently substituted region.','result':'User receives an actionable correction question.'},
 {'id':'SF-19','name':'Unsupported MongoDB handling','prompt':'Build Azure AKS app with MongoDB.','options':'centralindia; Python; private access.','plan':'No approval-ready plan.','code':'No substitute database scaffold.','negative':'DocumentDB, Atlas, PostgreSQL or MySQL presented as MongoDB.','result':'Clear unsupported message and supported choices.'},
 {'id':'SF-20','name':'Unsupported ACA Redis handling','prompt':'Build Azure Container Apps app with Redis.','options':'westeurope; Go; private access.','plan':'No approval-ready plan.','code':'No Redis substitute.','negative':'Fake Azure Redis adapter or plan/code disagreement.','result':'Clear capability boundary; no silent bad code.'},
 {'id':'SF-21','name':'Unsupported OKE PostgreSQL handling','prompt':'Build Oracle OKE with PostgreSQL.','options':'ap-mumbai-1; Go; private access.','plan':'No approval-ready plan.','code':'No MySQL substitution.','negative':'MySQL HeatWave described as PostgreSQL.','result':'Clear capability boundary.'},
 {'id':'SF-22','name':'Custom domain HTTPS boundary','prompt':'Build AWS EKS public HTTPS API.','options':'Custom domain HTTPS; Java; Redis; production.','plan':'Explicitly states domain/DNS/certificate input is required unless generated.','code':'No ACM/DNS resources unless profile actually contains them.','negative':'HTTPS certificate claim on AWS default hostname.','result':'No false production-TLS promise.'},
 {'id':'SF-23','name':'Regeneration after change','prompt':'Build Google Cloud Run Python API.','options':'Initial private/no DB; change to public HTTP/PostgreSQL; then regenerate.','plan':'New plan reflects public HTTP and PostgreSQL only.','code':'New scaffold contains DB resources and public access configuration.','negative':'Old private/no-data files retained.','result':'Regeneration requires a replacement plan and replaces stale files.'},
 {'id':'SF-24','name':'Automatic plan manifest gate','prompt':'Any supported prompt.','options':'Complete a normal interview.','plan':'File manifest matches final normalized paths exactly.','code':'Same set of generated paths plus requirements.json.','negative':'Invented alb_controller.tf, artifact_registry.tf, rds.tf, root/app layout mismatch or wrong CI file.','result':'Plan is blocked and repaired automatically before approval.'},
 {'id':'SF-25','name':'Generated scaffold validation gate','prompt':'Any supported prompt.','options':'Approve a valid plan and generate code.','plan':'Validation expectations match selected profile.','code':'Requirements manifest, Terraform/Helm/Docker/workflow files all present.','negative':'Missing runtime health endpoint, conflicting runtime files, stale outputs, dual CI.','result':'Run All Checks reports blocking failure or pass; Terraform plan remains credential-dependent.'},
]

doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(0.8); sec.bottom_margin = Inches(0.75)
sec.left_margin = Inches(0.8); sec.right_margin = Inches(0.8)

styles = doc.styles
normal = styles['Normal']; normal.font.name = 'Calibri'; normal._element.rPr.rFonts.set(qn('w:ascii'), 'Calibri'); normal.font.size = Pt(11)
for name, size, color in [('Heading 1',16,'2E74B5'),('Heading 2',13,'2E74B5'),('Heading 3',12,'1F4D78')]:
    s = styles[name]; s.font.name = 'Calibri'; s._element.rPr.rFonts.set(qn('w:ascii'), 'Calibri'); s.font.size = Pt(size); s.font.color.rgb = RGBColor.from_string(color)

p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after = Pt(4)
set_font(p.add_run('StackForge QA Test Pack'), size=24, bold=True, color='0B2545')
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after = Pt(18)
set_font(p.add_run('Requirements -> Architecture Plan -> Generated Scaffold -> Validation'), size=12, color='555555')

add_table(doc, [('Document use', 'Pre-release QA and regression testing'), ('Scope', 'All supported cloud/profile combinations and safety boundaries'), ('Pass rule', 'Requirements, plan, manifest, generated files and validator results must agree'), ('Important', 'Terraform plan requires client cloud credentials; terraform init/validate do not.')], header=False)

doc.add_heading('How to use this pack', level=1)
add_bullets(doc, [
    'Start each case with New Project or Reset Chat so prior requirements cannot affect the result.',
    'Enter the prompt, select the listed interview choices, then inspect the architecture plan before approval.',
    'For supported cases, download the ZIP and compare the plan File manifest against the ZIP paths.',
    'Run All Checks. Treat Terraform init/validate, Helm, Dockerfile and workflow results as the automated baseline; a live terraform plan needs client credentials.',
    'For unsupported cases, passing means the app blocks approval clearly and does not generate substitute infrastructure.',
    'Record screenshot, generated ZIP name, plan text, validator output, actual result and defect ID for every failure.'
])

doc.add_heading('Global acceptance criteria', level=1)
add_table(doc, [('Area','Pass criteria'),
    ('Requirements','Final selected values are preserved; latest client correction wins.'),
    ('Architecture plan','Uses only selected cloud, platform, CI, region, environments, runtime, access and data service.'),
    ('File manifest','Exactly matches final generated paths, including CI file and runtime layout.'),
    ('Generated code','Contains the selected runtime /health endpoint, one CI pipeline, and only selected data resources.'),
    ('Unsupported choice','Blocks before approval with a clear reason; never substitutes another technology.'),
    ('Validation','Blocking checks pass or explain external dependency; no stale repair should change client requirements.')])

doc.add_heading('Test scenarios', level=1)
for c in cases:
    add_case(doc, c)

doc.add_heading('Defect severity guide', level=1)
add_table(doc, [('Severity','Use when'),
    ('P0 - Release blocker','Wrong cloud/platform/CI/runtime/database; generated files contradict confirmed requirements; security exposure opposite to selected access; Terraform validate failure.'),
    ('P1 - Major','Plan promises resources/files not generated; CI cannot build/deploy; health endpoint or Helm deployment is inconsistent.'),
    ('P2 - Moderate','Wrong README, duplicate plan wording, missing non-blocking documentation, non-blocking lint warning.'),
    ('P3 - Minor','Visual wording, spacing, cosmetic chart metadata such as missing icon.')])

doc.add_heading('QA evidence template', level=1)
add_table(doc, [('Field','Record'),
    ('Test ID',''),('Build / deployment version',''),('Prompt and selected choices',''),('Expected result',''),('Actual plan result',''),('Actual ZIP / validator result',''),('Screenshot / ZIP evidence',''),('Pass / Fail',''),('Defect ID and severity','')])

doc.add_paragraph('End of QA test pack. Update this document whenever a new supported capability or regression test is added.').paragraph_format.space_before = Pt(12)
doc.save(OUT)
print(OUT)
