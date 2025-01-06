AllMonsters = [];
SRDonly = true;

class MythicForgeWindow {
    constructor() {

    }

    createWindow(title, content, options) {
        this.title = title;
        this.content = content;
        this.options = options;
        var html = `<div class="mythicForgeWindow" style='display:none'>
            <div class="windowHeader">${this.title}</div>
            <div class="windowContent">${this.content}</div>
            <div class="windowClose" title="Close this window"><i class='bx bx-x'></i></div>
        </div>`;
        this.el = $(html);
        $("body").append(this.el);
        setTimeout(() => {
            this.centerDivToScreen();
            this.initEvents();
        }, 1);
        console.log(this);
    }

    monsterStatBlock(name,source){
        var that = this;
        getMonsterByName(name,source).then(function(monster){
            if(monster){

                that.monster = monster;

                var monsterPicture = (monster.fluff)?(monster.fluff.images)?(monster.fluff.images[0].href.path) ? `<div class="monsterStatBlockImage"><img src="/assets/images/${monster.fluff.images[0].href.path}"></div>` : "":"":"";
                var monsterAlignment = Renderer.monster.getTypeAlignmentPart(monster);
                var monsterHP = Renderer.monster.getRenderedHp(monster.hp,{isPlainText:true});

                var html = `
                ${monsterPicture}
                <div class="monsterStatBlock">
                    <div class="section-left">
                            <div class="creature-heading">
                                <h1>${monster.name}</h1>
                                <h2>${monsterAlignment}</h2>
                            </div> <!-- creature heading -->
                            <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                            <div class="top-stats">
                                <div class="property-line first">
                                    <h4>Armor Class</h4>
                                    <p>18 (natural armor)</p>
                                </div> <!-- property line -->
                                <div class="property-line">
                                    <h4>Hit Points</h4>
                                    <p>${monsterHP}</p>
                                </div> <!-- property line -->
                                <div class="property-line last">
                                    <h4>Speed</h4>
                                    <p>25ft.</p>
                                </div> <!-- property line -->
                                <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                                <div class="abilities">
                                    <div class="ability-strength">
                                        <h4>STR</h4>
                                        <p>14 (+2)</p>
                                    </div> <!-- ability strength -->
                                    <div class="ability-dexterity">
                                        <h4>DEX</h4>
                                        <p>11 (+0)</p>
                                    </div> <!-- ability dexterity -->
                                    <div class="ability-constitution">
                                        <h4>CON</h4>
                                        <p>13 (+1)</p>
                                    </div> <!-- ability constitution -->
                                    <div class="ability-intelligence">
                                        <h4>INT</h4>
                                        <p>1 (-5)</p>
                                    </div> <!-- ability intelligence -->
                                    <div class="ability-wisdom">
                                        <h4>WIS</h4>
                                        <p>3 (-4)</p>
                                    </div> <!-- ability wisdom -->
                                    <div class="ability-charisma">
                                        <h4>CHA</h4>
                                        <p>1 (-5)</p>
                                    </div> <!-- ability charisma -->
                                </div> <!-- abilities -->
                                <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                                <div class="property-line first">
                                    <h4>Damage Immunities</h4>
                                    <p>poison, psychic</p>
                                </div> <!-- property line -->
                                <div class="property-line">
                                    <h4>Condition Immunities</h4>
                                    <p>blinded, charmed, deafened, exhaustion, frightened,
                                            petrified, poisoned</p>
                                </div> <!-- property line -->
                                <div class="property-line">
                                    <h4>Senses</h4>
                                    <p>blindsight 60ft. (blind beyond this radius), passive Perception 6</p>
                                </div> <!-- property line -->
                                <div class="property-line">
                                    <h4>Languages</h4>
                                    <p>&mdash;</p>
                                </div> <!-- property line -->
                                <div class="property-line last">
                                    <h4>Challenge</h4>
                                    <p>1 (200 XP)</p>
                                </div> <!-- property line -->
                            </div> <!-- top stats -->
                            <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                            <div class="property-block">
                                <h4>Antimagic Suceptibility.</h4>
                                <p>The armor is incapacitated while in the area of an <i>antimagic
                                field</i>.  If targeted by <i>dispel magic</i>, the armor must succeed
                                on a Constitution saving throw against the caster’s spell save DC or
                                fall unconscious for 1 minute.</p>
                            </div> <!-- property block -->
                            <div class="property-block">
                                <h4>False Appearance.</h4>
                                <p>While the armor remains motionless, it is indistinguishable from a
                                normal suit of armor.</p>
                            </div> <!-- property block -->
                        </div> <!-- section left -->
                        <div class="section-right">
                            <div class="actions">
                                <h3>Actions</h3>
                                <div class="property-block">
                                    <h4>Multiattack.</h4>
                                    <p>The armor makes two melee attacks.</p>
                                </div> <!-- property block -->
                                <div class="property-block">
                                    <h4>Slam.</h4>
                                    <p><i>Melee Weapon Attack:</i> +4 to hit, reach 5 ft., one target.
                            <i>Hit:</i> 5 (1d6 + 2) bludgeoning damage.</p>
                                </div> <!-- property block -->
                            </div> <!-- actions -->
                            <div class="actions">
                                <h3>Legendary Actions</h3>
                                <div class="property-block">
                                    <h4>Multiattack.</h4>
                                    <p>The armor makes two melee attacks.</p>
                                </div> <!-- property block -->
                                <div class="property-block">
                                    <h4>Slam.</h4>
                                    <p><i>Melee Weapon Attack:</i> +4 to hit, reach 5 ft., one target.
                            <i>Hit:</i> 5 (1d6 + 2) bludgeoning damage.</p>
                                </div> <!-- property block -->
                            </div> <!-- actions -->
                        </div> <!-- section right -->
                </div>
                </div>`;
                that.el.find(".windowContent").html(html);
                that.el.fadeIn(function(){
                });
                that.centerDivToScreen();
                that.createMonsterStory();
            }
        });

    }

    initEvents() {
        var that = this;
        this.el.on("click tap", function(evt) {
            if ($(this).hasClass("focused")) return;
            $(this).removeClass("focused");
            $(this).css("z-index", that.mythicForgeWindowIndex()).addClass("focused");
        });

        this.el.on("click tap", ".windowClose", function(evt) {
            $(this).parent().css("display", "none");
        });

        this.el.draggable({containment: "parent",onStart: function() {
            $(this).css("z-index", that.mythicForgeWindowIndex());
        }});
    }

    mythicForgeWindowIndex(){
        var highestZ = 0;
        $(".mythicForgeWindow").each(function() {
            var currentZ = parseInt($(this).css("z-index"), 10);
            if (currentZ > highestZ)
                highestZ = currentZ;
        });
        return highestZ;
    }

    centerDivToScreen(){
        var windowWidth = $(window).width();
        var windowHeight = $(window).height();
        var elementWidth = this.el.outerWidth();
        var elementHeight = this.el.outerHeight();

        this.el.css({
            "position": "fixed",
            "left": (windowWidth - elementWidth) / 2,
            "top": (windowHeight - elementHeight) / 2,
            "visibility": "visible"
        });

        var resizeTimer;

        // Recenter on window resize
        $(window).on('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.centerDivToScreen();
            }, 200);
        });
    }

    async createMonsterStory(){
        //create monster story using AI
        console.log(this.monster);
        if (this.monster){

                const response = await fetch('/story', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({monster: this.monster})
                });

                console.log(await response.json());
            /*
            var monsterStory = new MythicForgeWindow();
            monsterStory.createWindow("Monster Story", "");
            monsterStory.el.fadeIn();
            monsterStory.centerDivToScreen();*/
        }
    }
}

// Document ready function
$.when( $.ready ).then(function() {

    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY,1).then(function(data){
        AllMonsters = data;
        correctMonsterDetails();
        //getMonsterByName("Goblin","Mm").then(function(monster){console.log(monster)});
        //createMonsterStatBlock("Goblin","mm");
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow();
            bestiaryWindow.createWindow("Bestiary", `
                <div class="bestiaryContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
                <table class="bestiaryList">
                    <thead>
                        <tr>
                            <th>Monster</th>
                            <th>Type</th>
                            <th>CR</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                </table>
                </div>
            `);
            bestiaryWindow.el.addClass("bestiaryWindow");
            bestiaryWindow.el.fadeIn();

            $(".bestiaryWindow").on("click tap", ".bestiaryList .bestiaryItem", function(evt) {
                var monsterName = $(this).data("name");
                var monsterSource = $(this).data("source");
                createMonsterStatBlock(monsterName,monsterSource);
            });

            $(".bestiaryWindow").on("keyup", ".searchBestiary", function(evt) {
                var search = $(this).val().toLowerCase();
                var bestiaryList = $(".bestiaryWindow .bestiaryList");
                bestiaryList.find("tbody").remove();
                var tbody = $("<tbody></tbody>");

                $.each(AllMonsters, function(monsterIndex, monster){
                    if (monster.name.toLowerCase().includes(search)){
                        console.log(monster);
                        var monsterAlignment = Renderer.monster.getTypeAlignmentPart(monster);
                        var monsterCR = monster.cr;
                        var tr = `<tr class='bestiaryItem' data-name='${monster.name}' data-source='${monster.source}'>
                            <td>${monster.name}</td>
                            <td>${monsterAlignment}</td>
                            <td>${monsterCR}</td>
                            <td>${monster.source}</td>
                        </tr>`;
                        tbody.append(tr);
                    }
                });
                bestiaryList.append(tbody);
            });
        }else{
            if ($(".bestiaryWindow").css("display") == "block" && $(".bestiaryWindow").hasClass("focused")) {
                $(".bestiaryWindow").css("display", "none");
                return;
            }else{
                $(".bestiaryWindow").fadeIn();
            }
        }
    });
});

// Function to center a div to the screen
function centerDivToScreen(div){
    var divWidth = $(div).width();
    var divHeight = $(div).height();
    var windowWidth = $(window).width();
    var windowHeight = $(window).height();
    $(div).css({
        "left": windowWidth/2 - divWidth/2,
        "top": windowHeight/2 - divHeight/2
    });
}

// Monster related functions
function createMonsterStatBlock(monster,source){
    getMonsterByName(monster,source).then(function(theMonster){
        var monsterStatBlock = new MythicForgeWindow();
        monsterStatBlock.createWindow(theMonster.name, "");
        monsterStatBlock.monsterStatBlock(theMonster.name,theMonster.source);
    });
}

function correctMonsterDetails(){
    $.each(AllMonsters, function(monsterIndex, monster){
        if (monster){
            if (SRDonly)
                if (monster.srd){
                    //if srd is true, then the monster is from the srd
                    if (!monster.srd){
                        //remove the monster from the list
                        AllMonsters.splice(monsterIndex, 1);
                    }
                }else{
                    //remove the monster from the list
                    AllMonsters.splice(monsterIndex, 1);
                }
        }
    });
}

function getMonsterByName(name, source) {
    return new Promise((resolve, reject) => {
        let theMonster = AllMonsters.find(monster => monster.name.toLowerCase() === name.toLowerCase() && monster.source.toLowerCase() === source.toLowerCase());

        if (!theMonster) {
            reject("Monster not found");
            return;
        }

        DataLoader.pCacheAndGetHash("monsterFluff", UrlUtil.URL_TO_HASH_BUILDER["monsterFluff"]({ name: name, source: source }))
            .then(fluff => {
                theMonster.fluff = fluff;
                resolve(theMonster);
            })
            .catch(err => reject(err));
    });
}

