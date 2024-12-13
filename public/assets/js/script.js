AllMonsters = [];

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
        this.centerDivToScreen();
        this.initEvents();
    }

    monsterStatBlock(name,source){
        var monster = getMonsterByName(name,source);

        if(monster){
            var html = `
            <div class="monsterStatBlockImage"><img src="${monster.img_url}"></div>
            <div class="monsterStatBlock">
                <div class="section-left">
                        <div class="creature-heading">
                            <h1>${monster.name}</h1>
                            <h2>${Renderer.monster.getTypeAlignmentPart(monster)}</h2>
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
                                <p>${Renderer.monster.getRenderedHp(monster.hp,{isPlainText:true})}</p>
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
            this.el.find(".windowContent").html(html);
            this.el.fadeIn();
        }
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
        var $window = $(window);
        var windowWidth = $window.width();
        var windowHeight = $window.height();

        // Ensure the element is visible to get correct dimensions
        this.el.css("visibility", "hidden").show();
        var divWidth = this.el.outerWidth();
        var divHeight = this.el.outerHeight();

        var left = Math.max(0, (windowWidth - divWidth) / 2);
        var top = Math.max(0, (windowHeight - divHeight) / 2);

        this.el.css({
            "position": "absolute",
            "left": left + "px",
            "top": top + "px",
            "visibility": "visible"
        }).hide();
    }
}

// Document ready function
$.when( $.ready ).then(function() {

    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY,1).then(function(data){
        AllMonsters = data;
        correctMonsterDetails();
        console.log(getMonsterByName("Goblin","Mm"));
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow();
            bestiaryWindow.createWindow("Bestiary", `
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
            `);
            bestiaryWindow.el.addClass("bestiaryWindow");
            bestiaryWindow.el.fadeIn();
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

function createmonsterStatBlock(monster,source){
    var monsterStatBlock = new MythicForgeWindow();
    var theMonster = getMonsterByName(monster,source);
    monsterStatBlock.createWindow(theMonster.name, "");
    monsterStatBlock.monsterStatBlock(theMonster.name,theMonster.source);
}

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

function correctMonsterDetails(){
    $.each(AllMonsters, function(monsterIndex, monster){
        //if (Array.isArray(monster.alignment))
        //    monster.alignment = monster.alignment.map(a => Parser.alignmentAbvToFull(a)).join(" ").toTitleCase();
    });
}

function getMonsterByName(name,source){
    return AllMonsters.find(monster => monster.name.toLowerCase() === name.toLowerCase() && monster.source.toLowerCase() === source.toLowerCase());
}