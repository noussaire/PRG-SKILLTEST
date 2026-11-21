"""Reproduce PDF-only static fonts; never modifies the original variable font.
Requires FontTools 4.68.0 (development tool only); --fonttools may name a local
--target installation. Generated font software remains under assets/fonts/OFL.txt.
"""
import argparse, hashlib, json, pathlib, sys
parser=argparse.ArgumentParser()
parser.add_argument('--fonttools', help='Optional local directory containing FontTools')
args=parser.parse_args()
if args.fonttools: sys.path.insert(0, args.fonttools)
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
assert fontTools.__version__=='4.68.0', 'Requalify before changing the font build tool version'
directory=pathlib.Path(__file__).resolve().parent.parent/'assets'/'fonts'
source=directory/'NotoSansArabic.ttf'
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash=='63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e', 'Requalify changed source font'
outputs=[]
for weight,style in [(400,'Regular'),(700,'Bold')]:
    font=TTFont(source,recalcTimestamp=False)
    axes={a.axisTag:a.defaultValue for a in font['fvar'].axes};axes['wght']=weight
    instantiateVariableFont(font,axes,inplace=True,optimize=True)
    for platform,encoding,language in [(3,1,0x409),(1,0,0)]:
        for name_id in (1,16,21):font['name'].setName('SkillQuestArabicPDF',name_id,platform,encoding,language)
        for name_id in (2,17,22):font['name'].setName(style,name_id,platform,encoding,language)
        font['name'].setName('SkillQuest Arabic PDF '+style,4,platform,encoding,language)
        font['name'].setName('SkillQuestArabicPDF-'+style,6,platform,encoding,language)
    output=directory/('SkillQuestArabicPDF-'+style+'.ttf');font.save(output)
    outputs.append({'file':output.name,'axes':axes,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()})
(directory/'pdf-fonts-build.json').write_text(json.dumps({'source':source.name,'sourceSHA256':source_hash,'fontTools':fontTools.__version__,'license':'OFL.txt','outputs':outputs},indent=2)+'\n',encoding='utf8')
print(json.dumps(outputs))
