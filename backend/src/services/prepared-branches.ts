import type { SkillId } from "./prepared-bank.js";

// Four authored consequences per source question, in its original option order.
// Display order is shuffled independently. These are fictional branches, not
// predictions about a participant's real behavior or an AI-generated story.
type Branch = readonly [SkillId, string, string];
type FourBranches = readonly [Branch, Branch, Branch, Branch];
export const PREPARED_BRANCHES: Record<SkillId, FourBranches> = {
  communication: [
    ["ecoute-active", "Après votre exemple et la reformulation du groupe, un étudiant exprime une inquiétude que les autres n’avaient pas remarquée.", "بعد مثالك وإعادة صياغة الهدف، يعبر طالب عن قلق لم ينتبه إليه الآخرون."],
    ["prise-parole", "Votre résumé suscite de l’intérêt. Le groupe vous confie maintenant une présentation de trois minutes devant de nouveaux étudiants.", "أثار ملخصك الاهتمام. يكلفك الفريق الآن بعرض مدته ثلاث دقائق أمام طلبة جدد."],
    ["gestion-temps", "Votre présentation détaillée dépasse le temps prévu. Plusieurs demandes arrivent alors que la tâche principale reste à terminer.", "تجاوز عرضك المفصل الوقت المحدد. تصل طلبات متعددة بينما لم تكتمل المهمة الرئيسية."],
    ["gestion-conflits", "Après l’envoi du document, deux membres interprètent différemment les consignes et se reprochent leurs erreurs.", "بعد إرسال الوثيقة، يفسر عضوان التعليمات بشكل مختلف ويتبادلان اللوم على الأخطاء."],
  ],
  "ecoute-active": [
    ["empathie", "Votre reformulation aide le camarade à préciser ce qui le préoccupe. Vous remarquez qu’il s’implique moins depuis plusieurs jours.", "ساعدته إعادة الصياغة على توضيح ما يقلقه. تلاحظ أن مشاركته تراجعت منذ أيام."],
    ["inclusion", "Vous avez répondu au point principal, mais un autre membre estime que son avis n’a pas encore trouvé sa place.", "أجبت عن النقطة الأساسية، لكن عضوا آخر يشعر بأن رأيه لم يجد مكانه بعد."],
    ["gestion-conflits", "Pendant que vous préparez vos arguments, votre interlocuteur se sent peu écouté et l’échange devient tendu.", "أثناء إعداد حججك، يشعر محاورك بأنك لا تنصت إليه ويتوتر النقاش."],
    ["prise-decision", "Le changement de sujet apaise momentanément la réunion. Le désaccord reste toutefois entier et une décision doit être prise ce soir.", "هدأ الاجتماع مؤقتا بعد تغيير الموضوع، لكن الخلاف ما زال قائما ويجب اتخاذ قرار هذا المساء."],
  ],
  assertivite: [
    ["gestion-temps", "Après votre explication, le groupe accepte de réexaminer les priorités et vous demande de proposer un planning réaliste.", "بعد توضيحك، يوافق الفريق على مراجعة الأولويات ويطلب منك اقتراح برنامج واقعي."],
    ["negociation", "Le responsable entend votre limite, mais souhaite maintenir une partie de la demande. Il vous faut trouver un accord réalisable.", "تفهم المسؤول حدودك لكنه يريد الإبقاء على جزء من الطلب. تحتاجان إلى اتفاق قابل للتنفيذ."],
    ["gestion-stress", "Vous avez accepté la tâche supplémentaire. Plusieurs urgences s’accumulent maintenant dans votre planning.", "قبلت المهمة الإضافية. تتراكم الآن مهام عاجلة متعددة في برنامجك."],
    ["fiabilite", "Votre silence laisse croire que vous avez accepté. Le groupe attend un résultat alors que l’échéance approche.", "جعل صمتك الفريق يظن أنك وافقت. ينتظرون نتيجة بينما يقترب الموعد."],
  ],
  empathie: [
    ["collaboration", "L’échange privé révèle un obstacle concret. Pour aider ce membre, les deux sous-groupes doivent mieux coordonner leurs informations.", "كشف الحديث الخاص عائقا محددا. لمساعدة هذا العضو، يحتاج الفريقان الفرعيان إلى تنسيق معلوماتهما."],
    ["travail-equipe", "Votre question sur la répartition fait apparaître plusieurs tâches mal attribuées. Le groupe doit revoir les responsabilités.", "كشف سؤالك عن التوزيع مهاما غير موزعة بوضوح. يحتاج الفريق إلى مراجعة المسؤوليات."],
    ["assertivite", "Le membre n’apprécie pas que sa tâche lui soit retirée sans échange. Il vous demande de clarifier votre proposition et vos limites.", "لم يتقبل العضو سحب مهمته دون نقاش. يطلب منك توضيح اقتراحك وحدود دورك."],
    ["initiative", "En attendant une explication, la difficulté reste invisible au groupe. Vous repérez une petite amélioration possible que personne n’a encore proposée.", "بقيت الصعوبة غير ظاهرة للفريق أثناء انتظار التوضيح. تلاحظ تحسينا صغيرا لم يقترحه أحد بعد."],
  ],
  "travail-equipe": [
    ["planification", "Les responsabilités sont clarifiées. L’équipe vous demande maintenant de relier les différentes étapes à la date de l’événement.", "أصبحت المسؤوليات واضحة. يطلب منك الفريق ربط المراحل المختلفة بموعد الفعالية."],
    ["leadership", "Votre répartition est une bonne base, mais plusieurs membres hésitent encore à s’engager dans la prochaine étape.", "أصبح توزيعك أساسا للنقاش، لكن بعض الأعضاء ما زالوا مترددين في الالتزام بالخطوة التالية."],
    ["gestion-stress", "En prenant les tâches restantes, vous devenez le principal point de blocage et la charge augmente rapidement.", "بتولي المهام المتبقية أصبحت نقطة اعتماد رئيسية وازدادت أعباؤك بسرعة."],
    ["responsabilite", "Votre partie est terminée, mais une tâche oubliée provoque une erreur dans le document commun déjà transmis.", "أنهيت جزأك، لكن مهمة منسية تسببت في خطأ في الوثيقة المشتركة التي أرسلت بالفعل."],
  ],
  collaboration: [
    ["organisation", "Les deux groupes adoptent un espace commun. Il reste à décider comment suivre les tâches et éviter de nouvelles pertes d’information.", "اعتمد الفريقان فضاء مشتركا. بقي تحديد طريقة متابعة المهام وتفادي ضياع المعلومات مجددا."],
    ["negociation", "La comparaison des versions révèle des priorités différentes. Les groupes doivent trouver une base qui respecte leurs contraintes.", "كشفت مقارنة النسخ عن أولويات مختلفة. يحتاج الفريقان إلى أساس يراعي قيودهما."],
    ["autonomie", "Votre fusion permet d’avancer, mais certaines décisions dépassent peut-être votre rôle. Le responsable est momentanément indisponible.", "سمح الدمج بالتقدم، لكن بعض القرارات قد تتجاوز دورك. المسؤول غير متاح مؤقتا."],
    ["adaptabilite", "Pendant que les groupes attendent leurs versions respectives, une contrainte importante du projet change.", "أثناء انتظار كل فريق نسخة الآخر، تغير أحد القيود المهمة للمشروع."],
  ],
  leadership: [
    ["fiabilite", "Le groupe choisit ses prochaines actions. Un engagement pris envers l’équipe devient maintenant difficile à tenir.", "اختار الفريق خطواته التالية. أصبح الوفاء بأحد الالتزامات تجاهه صعبا الآن."],
    ["inclusion", "La majorité accepte votre plan, mais une personne peu présente dans la discussion semble ne pas avoir été entendue.", "وافقت الأغلبية على خطتك، لكن شخصا قليل المشاركة يبدو أنه لم يجد فرصة للتعبير."],
    ["gestion-conflits", "La répartition rapide évite une longue réunion, mais deux membres contestent les tâches reçues.", "تفادى التوزيع السريع اجتماعا طويلا، لكن عضوين يعترضان على المهام التي تلقياها."],
    ["initiative", "Aucune personne plus expérimentée ne se manifeste. Une petite action utile peut pourtant être proposée dès maintenant.", "لم يتقدم شخص أكثر خبرة. مع ذلك، يمكن اقتراح خطوة صغيرة مفيدة منذ الآن."],
  ],
  "gestion-conflits": [
    ["fiabilite", "Les deux membres conviennent d’une action vérifiable. Son échéance approche et l’un des engagements semble menacé.", "اتفق العضوان على خطوة قابلة للتحقق. يقترب موعدها ويبدو أحد الالتزامات مهددا."],
    ["negociation", "Le calme revient, mais les attentes restent différentes. Le groupe doit transformer l’échange en accord concret.", "عاد الهدوء، لكن التوقعات ما زالت مختلفة. يحتاج الفريق إلى تحويل النقاش إلى اتفاق ملموس."],
    ["empathie", "Votre choix tranche le désaccord, mais le membre dont l’idée n’a pas été retenue se retire progressivement.", "حسم اختيارك الخلاف، لكن العضو الذي لم يُؤخذ بفكرته بدأ ينسحب تدريجيا."],
    ["resilience", "Le sujet est écarté sans solution. La première activité se déroule ensuite moins bien que prévu.", "أُبعد الموضوع دون حل. جاءت الفعالية الأولى بعد ذلك دون التوقعات."],
  ],
  negociation: [
    ["planification", "Un accord équilibré est trouvé. Il faut maintenant transformer ses engagements en étapes et en dates réalistes.", "تم التوصل إلى اتفاق متوازن. حان تحويل التزاماته إلى مراحل ومواعيد واقعية."],
    ["influence", "Votre proposition réduite est réalisable, mais le partenaire souhaite mieux comprendre ses avantages.", "اقتراحك المخفف قابل للتنفيذ، لكن الشريك يريد فهما أفضل لمزاياه."],
    ["gestion-temps", "Les demandes acceptées sont plus nombreuses que prévu. Leur réalisation entre en concurrence avec les tâches prioritaires.", "أصبحت المطالب المقبولة أكثر من المتوقع. تنافس الآن المهام ذات الأولوية على وقت الإنجاز."],
    ["adaptabilite", "Le partenaire ne retient pas votre proposition initiale. Les conditions du projet doivent être réexaminées.", "لم يقبل الشريك عرضك الأول. أصبح من الضروري مراجعة شروط المشروع."],
  ],
  influence: [
    ["esprit-critique", "Le groupe accepte un essai limité. Une information très partagée semble confirmer votre idée et doit être vérifiée.", "وافق الفريق على تجربة محدودة. تبدو معلومة متداولة وكأنها تؤكد فكرتك وتحتاج إلى تحقق."],
    ["ecoute-active", "En évoquant les freins, un camarade formule une objection précise et demande à être entendu.", "أثناء الحديث عن العوائق، يقدم زميل اعتراضا محددا ويطلب أن يُنصت إليه."],
    ["prise-parole", "Votre enthousiasme attire l’attention. On vous demande de présenter la méthode à un public qui ne connaît pas encore le projet.", "جذب حماسك الانتباه. طُلب منك عرض الطريقة أمام جمهور لا يعرف المشروع بعد."],
    ["ethique", "Le responsable soutient votre méthode. Un partenaire vous demande en échange des informations sur les participants.", "دعم المسؤول طريقتك. طلب شريك بالمقابل معلومات عن المشاركين."],
  ],
  "prise-parole": [
    ["ecoute-active", "Votre message est compris. Pendant les questions du public, une personne exprime un désaccord inattendu.", "فُهمت رسالتك. أثناء أسئلة الجمهور، يعبر شخص عن اعتراض غير متوقع."],
    ["communication", "Les trois idées sont présentées, mais une partie du public découvre encore l’objectif concret du projet.", "عُرضت الأفكار الثلاث، لكن بعض الحاضرين ما زالوا يكتشفون الهدف العملي للمشروع."],
    ["gestion-temps", "La quantité d’informations allonge la présentation. Il reste peu de temps pour une tâche importante avant la prochaine échéance.", "أطالت كثرة المعلومات العرض. بقي وقت قليل لمهمة مهمة قبل الموعد التالي."],
    ["conscience-soi", "Après votre présentation improvisée, un retour du public ne correspond pas à l’impression que vous aviez de votre intervention.", "بعد عرضك المرتجل، تلقيت ملاحظة من الجمهور تختلف عن انطباعك عن أدائك."],
  ],
  "intelligence-emotionnelle": [
    ["gestion-conflits", "Votre réponse calme permet de reprendre les faits. Un désaccord entre deux autres membres devient maintenant visible.", "سمح ردك الهادئ بالعودة إلى الوقائع. ظهر الآن خلاف بين عضوين آخرين."],
    ["gestion-stress", "La pause vous aide à reprendre l’échange. Plusieurs urgences restent cependant à traiter dans la journée.", "ساعدتك الاستراحة على استئناف النقاش، لكن مهاما عاجلة متعددة ما زالت تنتظر المعالجة."],
    ["empathie", "Votre réponse immédiate clarifie votre position, mais votre interlocuteur paraît touché par le ton employé.", "وضح ردك الفوري موقفك، لكن محاورك يبدو متأثرا بالنبرة المستعملة."],
    ["assertivite", "Votre retrait laisse vos besoins et limites inconnus du groupe, qui vous adresse une nouvelle demande.", "ترك انسحابك احتياجاتك وحدودك غير واضحة للفريق، الذي يوجه إليك طلبا جديدا."],
  ],
  "conscience-soi": [
    ["apprentissage-continu", "L’exemple reçu vous aide à identifier un point précis à travailler. Il vous faut maintenant choisir une manière de progresser.", "ساعدك المثال الذي تلقيته على تحديد نقطة دقيقة للعمل عليها. تحتاج الآن إلى اختيار طريقة للتطور."],
    ["curiosite", "Les améliorations proposées font apparaître une méthode que vous ne connaissez pas encore.", "كشفت التحسينات المقترحة عن طريقة لا تعرفها بعد."],
    ["ecoute-active", "Vos efforts sont reconnus, mais le camarade insiste sur un aspect de son retour qui n’a pas encore été reformulé.", "اعتُرف بجهودك، لكن الزميل يؤكد جانبا من ملاحظاته لم يُعد توضيحه بعد."],
    ["resilience", "Le retour est mis de côté. Lors d’une nouvelle activité, une difficulté proche se présente à nouveau.", "وضعت الملاحظات جانبا. في فعالية جديدة ظهرت صعوبة مشابهة مرة أخرى."],
  ],
  "gestion-stress": [
    ["planification", "Les priorités deviennent plus claires après votre pause. Le groupe souhaite maintenant anticiper les étapes suivantes.", "أصبحت الأولويات أوضح بعد الاستراحة. يريد الفريق الآن الاستعداد للمراحل التالية."],
    ["organisation", "Traiter une tâche à la fois vous aide à avancer. Vous remarquez cependant que plusieurs informations sont dispersées.", "ساعدتك معالجة مهمة واحدة كل مرة على التقدم، لكنك لاحظت تشتت المعلومات."],
    ["assertivite", "Votre journée se prolonge et une nouvelle tâche vous est proposée. Vous devez exprimer ce qui reste réaliste.", "طال يوم عملك واقتُرحت عليك مهمة جديدة. تحتاج إلى توضيح ما بقي واقعيا."],
    ["fiabilite", "Les messages reportés contiennent une demande de confirmation. Un engagement pris envers le groupe risque maintenant d’être manqué.", "تضمنت الرسائل المؤجلة طلب تأكيد. أصبح أحد التزاماتك تجاه الفريق مهددا."],
  ],
  resilience: [
    ["resolution-problemes", "L’analyse collective retient une piste d’amélioration. Un problème persistant doit maintenant être testé à partir de faits.", "اختار التحليل الجماعي مسارا للتحسين. تحتاج مشكلة مستمرة الآن إلى اختبار انطلاقا من الوقائع."],
    ["apprentissage-continu", "Les retours encouragent une nouvelle tentative. Vous souhaitez transformer ces conseils en entraînement concret.", "شجعتك الملاحظات على محاولة جديدة. تريد تحويل النصائح إلى تدريب عملي."],
    ["esprit-critique", "La relance de la même activité apporte de nouveaux résultats. Le groupe doit distinguer ses impressions des informations vérifiées.", "أعطت إعادة نفس الفعالية نتائج جديدة. على الفريق التمييز بين انطباعاته والمعلومات المتحقق منها."],
    ["adaptabilite", "L’activité est abandonnée. Pour conserver l’objectif général, le groupe doit changer sa manière de travailler.", "تم التخلي عن الفعالية. للحفاظ على الهدف العام، يحتاج الفريق إلى تغيير طريقة عمله."],
  ],
  adaptabilite: [
    ["prise-decision", "Plusieurs alternatives sont identifiées avec le groupe. Aucune n’est parfaite et une décision est attendue ce soir.", "حُددت بدائل متعددة مع الفريق. لا يوجد حل مثالي ويجب اتخاذ قرار هذا المساء."],
    ["collaboration", "Le groupe connaît votre solution de remplacement. Les deux sous-groupes doivent maintenant harmoniser leurs documents.", "أصبح الفريق على علم بالبديل. يحتاج الفريقان الفرعيان الآن إلى توحيد وثائقهما."],
    ["planification", "Le premier lieu disponible permet de garder la date, mais il modifie plusieurs dépendances du calendrier.", "سمح أول مكان متاح بالحفاظ على الموعد، لكنه غير الترابط بين مراحل الجدول."],
    ["initiative", "Le lieu initial n’est toujours pas confirmé. Une petite démarche utile peut être lancée sans attendre cette confirmation.", "لم يتأكد المكان الأول بعد. يمكن بدء خطوة صغيرة مفيدة دون انتظار هذا التأكيد."],
  ],
  creativite: [
    ["resolution-problemes", "Le petit essai apporte des observations nouvelles. Le groupe doit comprendre pourquoi une partie de la solution fonctionne moins bien.", "قدمت التجربة الصغيرة ملاحظات جديدة. يحتاج الفريق إلى فهم سبب ضعف جزء من الحل."],
    ["inclusion", "Plusieurs idées sont proposées, mais certaines personnes n’ont pas contribué à la discussion.", "اقتُرحت أفكار متعددة، لكن بعض الأشخاص لم يساهموا في النقاش."],
    ["esprit-critique", "L’idée reprise ailleurs semble prometteuse. Son adéquation au public et les informations qui la soutiennent doivent encore être vérifiées.", "تبدو الفكرة المنقولة واعدة. ما زال من الضروري التحقق من ملاءمتها للجمهور والمعلومات التي تدعمها."],
    ["curiosite", "La méthode habituelle rassure le groupe. Une nouvelle méthode est toutefois proposée par un autre membre.", "طمأنت الطريقة المعتادة الفريق. مع ذلك، اقترح عضو آخر طريقة جديدة."],
  ],
  "esprit-critique": [
    ["prise-decision", "Les sources recoupées ne conduisent pas toutes à la même conclusion. Vous devez choisir avec une part d’incertitude.", "لم تؤد المصادر المقارنة كلها إلى نفس الاستنتاج. عليك اتخاذ قرار مع بقاء قدر من عدم اليقين."],
    ["communication", "Une source reconnue clarifie une partie du sujet. Le groupe vous demande de lui expliquer simplement ce qui est établi.", "وضح مصدر موثوق جزءا من الموضوع. يطلب منك الفريق شرح ما تأكد ببساطة."],
    ["influence", "L’avis majoritaire se dessine. Vous souhaitez proposer un essai plutôt qu’une adoption définitive de la méthode.", "اتضح رأي الأغلبية. تريد اقتراح تجربة بدل اعتماد الطريقة نهائيا."],
    ["responsabilite", "L’information partagée s’avère incomplète après son utilisation dans un document envoyé au partenaire.", "تبين أن المعلومة المتداولة غير مكتملة بعد استخدامها في وثيقة أُرسلت إلى الشريك."],
  ],
  "resolution-problemes": [
    ["apprentissage-continu", "Le test d’une action fournit des résultats mesurables. Vous souhaitez en faire une méthode d’apprentissage pour les prochains projets.", "أعطى اختبار الإجراء نتائج قابلة للقياس. تريد تحويله إلى طريقة للتعلم في المشاريع المقبلة."],
    ["empathie", "Les étudiants interrogés décrivent des freins différents. L’un d’eux paraît moins à l’aise pour expliquer sa difficulté.", "وصف الطلبة عوائق مختلفة. يبدو أحدهم أقل ارتياحا لتوضيح صعوبته."],
    ["creativite", "Les relances supplémentaires mobilisent du temps sans changer nettement les inscriptions. Le groupe doit explorer d’autres idées.", "استهلكت التذكيرات الإضافية وقتا دون تغيير واضح في التسجيلات. يحتاج الفريق إلى استكشاف أفكار أخرى."],
    ["planification", "À la fin des inscriptions, le problème est mieux visible mais la marge disponible avant l’événement est devenue courte.", "أصبحت المشكلة أوضح عند نهاية التسجيلات، لكن الهامش قبل الفعالية أصبح قصيرا."],
  ],
  "prise-decision": [
    ["fiabilite", "Votre décision est expliquée au groupe. Sa réussite dépend maintenant d’un engagement précis pris envers les autres.", "أوضحت قرارك للفريق. أصبح نجاحه مرتبطا بالتزام محدد تجاه الآخرين."],
    ["collaboration", "Les personnes consultées soutiennent le choix. Elles doivent maintenant coordonner leurs contributions.", "دعم الأشخاص الذين استشرتهم القرار. يحتاجون الآن إلى تنسيق مساهماتهم."],
    ["esprit-critique", "L’option rassurante est retenue. Une information contradictoire circule ensuite dans le groupe.", "تم اختيار الحل الذي يمنح الاطمئنان. انتشرت بعد ذلك معلومة تناقضه داخل الفريق."],
    ["gestion-temps", "La recherche d’informations supplémentaires a consommé une partie du délai. Une tâche importante attend encore.", "استهلك البحث عن معلومات إضافية جزءا من المهلة. ما زالت مهمة مهمة تنتظر."],
  ],
  "gestion-temps": [
    ["assertivite", "Votre planning protège la tâche importante. Une nouvelle demande oblige toutefois à discuter vos limites.", "حافظ برنامجك على وقت المهمة المهمة. لكن طلبا جديدا يتطلب مناقشة حدودك."],
    ["organisation", "La priorité est terminée. Pour traiter les autres demandes, vous devez retrouver des informations dispersées.", "أُنجزت الأولوية. لمعالجة الطلبات الأخرى تحتاج إلى جمع معلومات متفرقة."],
    ["planification", "Les petites demandes sont traitées, mais la tâche importante dispose maintenant de moins de temps que prévu.", "عولجت الطلبات الصغيرة، لكن الوقت المتبقي للمهمة المهمة أصبح أقل من المتوقع."],
    ["gestion-stress", "Les notifications vous font changer souvent de tâche. Plusieurs urgences restent ouvertes en même temps.", "دفعتك الإشعارات إلى تغيير المهمة باستمرار. بقيت مهام عاجلة متعددة مفتوحة في الوقت نفسه."],
  ],
  organisation: [
    ["travail-equipe", "Le suivi partagé rend les tâches visibles. Certaines responsabilités doivent encore être clarifiées avec le groupe.", "جعلت المتابعة المشتركة المهام واضحة. ما زالت بعض المسؤوليات تحتاج إلى توضيح مع الفريق."],
    ["fiabilite", "La liste commune rappelle une échéance proche. Vous constatez qu’un engagement pourrait être difficile à tenir.", "ذكرت القائمة المشتركة بموعد قريب. لاحظت أن الوفاء بأحد الالتزامات قد يكون صعبا."],
    ["collaboration", "Votre liste personnelle vous aide, mais les informations des deux sous-groupes ne sont pas encore harmonisées.", "ساعدتك قائمتك الشخصية، لكن معلومات الفريقين الفرعيين لم تُوحد بعد."],
    ["autonomie", "Une information importante reste introuvable dans les messages et le responsable n’est pas disponible pour vous guider.", "بقيت معلومة مهمة غير موجودة بين الرسائل والمسؤول غير متاح لإرشادك."],
  ],
  planification: [
    ["adaptabilite", "Le calendrier prévoit une marge. Une contrainte de lieu change néanmoins et le plan doit être ajusté.", "يتضمن الجدول هامشا للطوارئ. تغير مع ذلك أحد قيود المكان وأصبحت الخطة بحاجة إلى تعديل."],
    ["leadership", "Les grandes étapes sont fixées. Le groupe cherche encore une direction claire pour commencer la prochaine phase.", "حُددت المراحل الكبرى. ما زال الفريق يبحث عن اتجاه واضح لبدء المرحلة المقبلة."],
    ["gestion-temps", "Les premières tâches montrent des durées très différentes. Il faut réexaminer ce qui peut tenir dans le temps restant.", "أظهرت المهام الأولى اختلافا كبيرا في مددها. يجب مراجعة ما يمكن إنجازه في الوقت المتبقي."],
    ["responsabilite", "Un oubli apparaît dans les préparatifs et affecte un document que vous avez déjà transmis.", "ظهر نسيان في الاستعدادات وأثر في وثيقة أرسلتها بالفعل."],
  ],
  autonomie: [
    ["initiative", "Votre recherche identifie une piste sûre. Vous repérez aussi une amélioration utile qui n’avait pas été demandée.", "حدد بحثك حلا آمنا. لاحظت أيضا تحسينا مفيدا لم يكن مطلوبا."],
    ["curiosite", "Les documents disponibles mentionnent une méthode inconnue qui pourrait aider le groupe.", "ذكرت الوثائق المتاحة طريقة غير مألوفة قد تساعد الفريق."],
    ["ethique", "La solution choisie soulève une question d’autorisation et de confidentialité des informations utilisées.", "أثار الحل المختار سؤالا حول الإذن وسرية المعلومات المستعملة."],
    ["fiabilite", "Le responsable tarde à revenir et votre engagement envers le groupe risque de ne plus tenir dans le délai prévu.", "تأخرت عودة المسؤول وأصبح التزامك تجاه الفريق مهددا بعدم احترام الموعد."],
  ],
  initiative: [
    ["resolution-problemes", "Le petit essai est accepté. Il faut maintenant vérifier son effet à partir de faits.", "قُبلت التجربة الصغيرة. حان التحقق من أثرها انطلاقا من الوقائع."],
    ["leadership", "Le groupe accueille votre première étape et vous demande d’aider les autres à se mobiliser.", "رحب الفريق بخطوتك الأولى وطلب منك المساعدة في تحفيز الآخرين على المشاركة."],
    ["gestion-conflits", "Le changement direct surprend certains membres, qui contestent la manière dont il a été décidé.", "فاجأ التغيير المباشر بعض الأعضاء، فاعترضوا على طريقة اتخاذ القرار."],
    ["assertivite", "L’occasion d’amélioration reste ouverte. Une nouvelle demande vous invite à exprimer plus clairement votre proposition.", "بقيت فرصة التحسين متاحة. يدعوك طلب جديد إلى التعبير بوضوح أكبر عن اقتراحك."],
  ],
  responsabilite: [
    ["fiabilite", "La correction est organisée avec les personnes concernées. Vous devez maintenant tenir l’engagement pris pour la prochaine version.", "نُظم التصحيح مع المعنيين. عليك الآن الوفاء بالالتزام المتعلق بالنسخة المقبلة."],
    ["communication", "La version corrigée est envoyée. Le groupe vous demande d’expliquer simplement ce qui a changé.", "أُرسلت النسخة المصححة. يطلب منك الفريق شرح التغييرات ببساطة."],
    ["ethique", "L’ancienne version continue à circuler. Vous devez réfléchir à la manière de traiter les informations transmises et la confiance du partenaire.", "ما زالت النسخة القديمة متداولة. تحتاج إلى التفكير في المعلومات المرسلة وثقة الشريك."],
    ["conscience-soi", "Le problème est finalement signalé par un autre membre. Son retour sur votre réaction vous surprend.", "أشار عضو آخر إلى المشكلة في النهاية. فاجأتك ملاحظته حول رد فعلك."],
  ],
  fiabilite: [
    ["negociation", "Votre alerte précoce permet de discuter une nouvelle échéance. Le partenaire exprime cependant des attentes supplémentaires.", "سمح تنبيهك المبكر بمناقشة موعد جديد، لكن الشريك عبر عن توقعات إضافية."],
    ["travail-equipe", "Le groupe accepte de vous aider. Il faut maintenant répartir clairement les tâches restantes.", "وافق الفريق على مساعدتك. تحتاج المهام المتبقية الآن إلى توزيع واضح."],
    ["gestion-stress", "Vous poursuivez seul jusqu’au dernier moment. La charge et les urgences se concentrent maintenant sur la même journée.", "واصلت وحدك حتى اللحظة الأخيرة. تركزت الآن الأعباء والمهام العاجلة في اليوم نفسه."],
    ["responsabilite", "Le retard finit par être remarqué et une information transmise au groupe doit être corrigée.", "لوحظ التأخير في النهاية وأصبحت معلومة أُرسلت إلى الفريق بحاجة إلى تصحيح."],
  ],
  "apprentissage-continu": [
    ["conscience-soi", "Votre pratique fournit un premier retour précis. Il vous faut comparer ce retour à votre propre perception.", "قدم تدريبك ملاحظة أولية دقيقة. تحتاج إلى مقارنتها بتصورك عن نفسك."],
    ["curiosite", "La ressource choisie vous fait découvrir une méthode encore peu familière au groupe.", "عرّفك المورد المختار على طريقة لم يألفها الفريق بعد."],
    ["organisation", "Les ressources s’accumulent sans application définie. Le groupe a besoin d’une méthode pour suivre les prochaines actions.", "تراكمت الموارد دون تطبيق محدد. يحتاج الفريق إلى طريقة لمتابعة الخطوات المقبلة."],
    ["resilience", "Un nouveau projet présente une difficulté proche. Vous devez choisir comment réagir à cette répétition.", "عرض مشروع جديد صعوبة مشابهة. عليك اختيار طريقة التعامل مع تكرارها."],
  ],
  curiosite: [
    ["creativite", "Le petit essai ouvre plusieurs pistes possibles. Le groupe veut en tirer une idée adaptée à ses moyens.", "فتحت التجربة الصغيرة مسارات متعددة. يريد الفريق استخراج فكرة تناسب إمكاناته."],
    ["esprit-critique", "La démonstration semble utile. Les éléments qui soutiennent cette impression doivent encore être vérifiés.", "بدا العرض التطبيقي مفيدا. ما زال من الضروري التحقق من الأدلة التي تدعم هذا الانطباع."],
    ["influence", "La méthode est populaire, mais quelques membres demandent des arguments plus concrets avant de l’essayer.", "الطريقة شائعة، لكن بعض الأعضاء يطلبون حججا أكثر تحديدا قبل تجربتها."],
    ["adaptabilite", "Le groupe reste sur la méthode connue. Une nouvelle contrainte l’oblige néanmoins à revoir ses habitudes.", "بقي الفريق على الطريقة المعروفة. فرض قيد جديد مع ذلك مراجعة عاداته."],
  ],
  inclusion: [
    ["collaboration", "L’adaptation proposée permet de recueillir un nouvel avis. Les sous-groupes doivent maintenant intégrer cette contribution.", "سمح التعديل المقترح بجمع رأي جديد. يحتاج الفريقان الفرعيان الآن إلى إدماج هذه المساهمة."],
    ["ecoute-active", "La personne accepte de donner son avis autrement et exprime une réserve sur la proposition actuelle.", "قبل الشخص تقديم رأيه بطريقة أخرى وعبر عن تحفظ بشأن الاقتراح الحالي."],
    ["empathie", "La demande publique met la personne mal à l’aise. Elle participe ensuite moins aux échanges.", "سبب الطلب أمام الجميع إحراجا للشخص. تراجعت مشاركته بعد ذلك."],
    ["leadership", "La décision est prise par les membres les plus présents. Le groupe doit maintenant mobiliser l’ensemble de l’équipe.", "اتخذ القرار الأعضاء الأكثر حضورا. يحتاج الفريق الآن إلى إشراك بقية الأعضاء في العمل."],
  ],
  ethique: [
    ["communication", "Votre vérification conduit à une solution qui protège les données. Le partenaire vous demande de lui expliquer clairement cette solution.", "أدى تحققك إلى حل يحمي البيانات. يطلب الشريك شرح هذا الحل بوضوح."],
    ["autonomie", "Le responsable ne peut pas vous répondre immédiatement. Vous devez identifier les démarches sûres possibles dans votre rôle.", "لا يستطيع المسؤول الرد فورا. تحتاج إلى تحديد الخطوات الآمنة الممكنة ضمن دورك."],
    ["responsabilite", "Une personne questionne l’autorisation de transmettre son adresse. Il faut traiter les conséquences du partage effectué.", "تساءل شخص عن الإذن بإرسال عنوانه. أصبح من الضروري معالجة آثار المشاركة التي تمت."],
    ["gestion-conflits", "Le partage de la liste provoque un désaccord entre les membres du groupe au sujet de la confiance et des engagements.", "أثارت مشاركة القائمة خلافا بين أعضاء الفريق حول الثقة والالتزامات."],
  ],
};
